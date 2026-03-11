/* *
 * Skill de controle de pressão arterial.
 * Permite registrar medições de pressão arterial e enviar resumos por e-mail.
 *
 * Variáveis de ambiente necessárias:
 *   S3_BUCKET_NAME        – bucket S3 onde os registros são armazenados
 *   EMAIL_DESTINATARIO    – endereço de e-mail que receberá os resumos
 *   EMAIL_REMETENTE       – endereço de e-mail verificado no SES usado como remetente
 *   SES_REGION            – região AWS do SES (padrão: us-east-1)
 *   TIMEZONE              – fuso horário para exibição de data/hora (padrão: America/Sao_Paulo)
 * */
const Alexa = require('ask-sdk-core');
const AWS = require('aws-sdk');

// Validate required environment variables at cold-start to surface misconfigurations early
const REQUIRED_ENV_VARS = ['S3_BUCKET_NAME', 'EMAIL_DESTINATARIO', 'EMAIL_REMETENTE'];
REQUIRED_ENV_VARS.forEach(varName => {
    if (!process.env[varName]) {
        throw new Error(`Variável de ambiente obrigatória não definida: ${varName}`);
    }
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME;
const DATA_KEY = 'pressao-arterial.json';
const EMAIL_DESTINATARIO = process.env.EMAIL_DESTINATARIO;
const EMAIL_REMETENTE = process.env.EMAIL_REMETENTE;
const TIMEZONE = process.env.TIMEZONE || 'America/Sao_Paulo';

const s3 = new AWS.S3({ signatureVersion: 'v4' });
const ses = new AWS.SES({ region: process.env.SES_REGION || 'us-east-1' });

/* ---------- Helpers de persistência ---------- */

async function lerRegistros() {
    try {
        const data = await s3.getObject({ Bucket: BUCKET_NAME, Key: DATA_KEY }).promise();
        return JSON.parse(data.Body.toString('utf-8'));
    } catch (err) {
        if (err.code === 'NoSuchKey') return [];
        throw err;
    }
}

async function salvarRegistros(registros) {
    await s3.putObject({
        Bucket: BUCKET_NAME,
        Key: DATA_KEY,
        Body: JSON.stringify(registros, null, 2),
        ContentType: 'application/json'
    }).promise();
}

/* ---------- Classificação da pressão ---------- */

function classificarPressao(sistolica, diastolica) {
    if (sistolica < 120 && diastolica < 80) return 'Normal';
    if ((sistolica >= 120 && sistolica <= 129) && diastolica < 80) return 'Elevada';
    if ((sistolica >= 130 && sistolica <= 139) || (diastolica >= 80 && diastolica <= 89)) return 'Hipertensão Estágio 1';
    if (sistolica >= 140 || diastolica >= 90) return 'Hipertensão Estágio 2';
    return 'Não classificada';
}

/* ---------- Formatação de e-mail HTML ---------- */

function gerarHtmlEmail(registros, dias) {
    const linhas = registros.map(r => {
        const classificacao = classificarPressao(r.sistolica, r.diastolica);
        return `
            <tr>
                <td style="padding:8px;border:1px solid #ddd;">${r.data}</td>
                <td style="padding:8px;border:1px solid #ddd;">${r.hora}</td>
                <td style="padding:8px;border:1px solid #ddd;text-align:center;">${r.sistolica}</td>
                <td style="padding:8px;border:1px solid #ddd;text-align:center;">${r.diastolica}</td>
                <td style="padding:8px;border:1px solid #ddd;">${classificacao}</td>
            </tr>`;
    }).join('');

    const tabelaOuMensagem = registros.length === 0
        ? '<p>Nenhum registro encontrado para o período solicitado.</p>'
        : `<table style="width:100%;border-collapse:collapse;">
            <thead>
                <tr style="background:#c0392b;color:#fff;">
                    <th style="padding:8px;border:1px solid #ddd;">Data</th>
                    <th style="padding:8px;border:1px solid #ddd;">Hora</th>
                    <th style="padding:8px;border:1px solid #ddd;">Sistólica (mmHg)</th>
                    <th style="padding:8px;border:1px solid #ddd;">Diastólica (mmHg)</th>
                    <th style="padding:8px;border:1px solid #ddd;">Classificação</th>
                </tr>
            </thead>
            <tbody>${linhas}</tbody>
          </table>`;

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><title>Resumo de Pressão Arterial</title></head>
<body style="font-family:Arial,sans-serif;color:#333;max-width:700px;margin:0 auto;">
    <h2 style="color:#c0392b;">Resumo de Pressão Arterial &ndash; Últimos ${dias} dia(s)</h2>
    <p>Total de registros encontrados: <strong>${registros.length}</strong></p>
    ${tabelaOuMensagem}
    <p style="margin-top:24px;font-size:12px;color:#888;">
        Gerado automaticamente pela Skill Alexa de Pressão Arterial.
    </p>
</body>
</html>`;
}

/* ---------- Handlers ---------- */

const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
    },
    handle(handlerInput) {
        const speakOutput = 'Olá! Bem-vindo à sua skill de pressão arterial. '
            + 'Você pode dizer "anote minha pressão arterial" para registrar uma medição, '
            + 'ou "me envie o resumo da pressão dos últimos sete dias" para receber um resumo por e-mail.';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt('Como posso ajudar? Diga "anote minha pressão arterial" ou "me envie o resumo".')
            .getResponse();
    }
};

const RegistrarPressaoIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'RegistrarPressaoIntent';
    },
    async handle(handlerInput) {
        const slots = handlerInput.requestEnvelope.request.intent.slots;

        const sistolicaVal = slots.sistolica && slots.sistolica.value;
        const diastolicaVal = slots.diastolica && slots.diastolica.value;

        // Elicitar sistólica se não informada
        if (!sistolicaVal) {
            return handlerInput.responseBuilder
                .speak('Qual é o valor da sua pressão sistólica, o número maior?')
                .reprompt('Por favor, informe o valor sistólico da sua pressão.')
                .addElicitSlotDirective('sistolica')
                .getResponse();
        }

        // Elicitar diastólica se não informada
        if (!diastolicaVal) {
            return handlerInput.responseBuilder
                .speak('Qual é o valor da sua pressão diastólica, o número menor?')
                .reprompt('Por favor, informe o valor diastólico da sua pressão.')
                .addElicitSlotDirective('diastolica')
                .getResponse();
        }

        const sistolica = parseInt(sistolicaVal, 10);
        const diastolica = parseInt(diastolicaVal, 10);

        if (isNaN(sistolica) || isNaN(diastolica) || sistolica <= 0 || diastolica <= 0
                || sistolica > 300 || diastolica > 200) {
            return handlerInput.responseBuilder
                .speak('Os valores informados não são válidos. A pressão sistólica deve estar entre 1 e 300, e a diastólica entre 1 e 200. Por favor, tente novamente.')
                .reprompt('Diga novamente os valores da sua pressão arterial.')
                .getResponse();
        }

        // Gravar registro no S3
        const agora = new Date();
        const data = agora.toLocaleDateString('pt-BR', { timeZone: TIMEZONE });
        const hora = agora.toLocaleTimeString('pt-BR', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', second: '2-digit' });

        const novoRegistro = {
            data,
            hora,
            sistolica,
            diastolica,
            timestamp: agora.toISOString()
        };

        const registros = await lerRegistros();
        registros.push(novoRegistro);
        await salvarRegistros(registros);

        const classificacao = classificarPressao(sistolica, diastolica);
        const speakOutput = `Pressão arterial ${sistolica} por ${diastolica} registrada com sucesso! `
            + `Classificação: ${classificacao}.`;

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .getResponse();
    }
};

const EnviarResumoPressaoIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'EnviarResumoPressaoIntent';
    },
    async handle(handlerInput) {
        const slots = handlerInput.requestEnvelope.request.intent.slots;
        const diasVal = slots.dias && slots.dias.value;

        // Elicitar número de dias se não informado
        if (!diasVal) {
            return handlerInput.responseBuilder
                .speak('De quantos dias você quer o resumo da pressão?')
                .reprompt('Informe o número de dias para o resumo.')
                .addElicitSlotDirective('dias')
                .getResponse();
        }

        const dias = parseInt(diasVal, 10);

        if (isNaN(dias) || dias <= 0 || dias > 365) {
            return handlerInput.responseBuilder
                .speak('O número de dias informado não é válido. Por favor, informe um valor entre 1 e 365.')
                .reprompt('Informe um número de dias válido para o resumo.')
                .getResponse();
        }

        // Calcular data de corte
        const agora = new Date();
        const dataCorte = new Date(agora);
        dataCorte.setDate(dataCorte.getDate() - dias);

        // Filtrar registros pelo período
        const todos = await lerRegistros();
        const filtrados = todos.filter(r => new Date(r.timestamp) >= dataCorte);

        // Enviar e-mail via SES
        const htmlBody = gerarHtmlEmail(filtrados, dias);
        const textBody = filtrados.length === 0
            ? `Nenhum registro encontrado nos últimos ${dias} dia(s).`
            : filtrados.map(r =>
                `${r.data} ${r.hora} - Sistólica: ${r.sistolica} mmHg | Diastólica: ${r.diastolica} mmHg | ${classificarPressao(r.sistolica, r.diastolica)}`
            ).join('\n');

        await ses.sendEmail({
            Source: EMAIL_REMETENTE,
            Destination: { ToAddresses: [EMAIL_DESTINATARIO] },
            Message: {
                Subject: { Data: `Resumo de Pressão Arterial - Últimos ${dias} dia(s)`, Charset: 'UTF-8' },
                Body: {
                    Text: { Data: textBody, Charset: 'UTF-8' },
                    Html: { Data: htmlBody, Charset: 'UTF-8' }
                }
            }
        }).promise();

        const plural = dias > 1 ? 's' : '';
        const speakOutput = filtrados.length === 0
            ? `Não encontrei nenhum registro nos últimos ${dias} dia${plural}. O e-mail foi enviado informando isso.`
            : `Resumo enviado para o seu e-mail com ${filtrados.length} registro${filtrados.length > 1 ? 's' : ''} dos últimos ${dias} dia${plural}.`;

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .getResponse();
    }
};

const HelpIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
        const speakOutput = 'Você pode dizer "anote minha pressão arterial" seguido dos valores sistólico e diastólico, '
            + 'por exemplo: "anote minha pressão arterial 120 por 80". '
            + 'Para receber um resumo por e-mail, diga "me envie o resumo da pressão dos últimos sete dias". '
            + 'Como posso ajudar?';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

const CancelAndStopIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent'
                || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent');
    },
    handle(handlerInput) {
        return handlerInput.responseBuilder
            .speak('Até logo!')
            .getResponse();
    }
};

const FallbackIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.FallbackIntent';
    },
    handle(handlerInput) {
        const speakOutput = 'Desculpe, não entendi o que você disse. '
            + 'Diga "anote minha pressão arterial" ou "me envie o resumo da pressão".';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
    },
    handle(handlerInput) {
        console.log(`~~~~ Sessão encerrada: ${JSON.stringify(handlerInput.requestEnvelope)}`);
        return handlerInput.responseBuilder.getResponse();
    }
};

const IntentReflectorHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest';
    },
    handle(handlerInput) {
        const intentName = Alexa.getIntentName(handlerInput.requestEnvelope);
        return handlerInput.responseBuilder
            .speak(`Você acionou o intent ${intentName}`)
            .getResponse();
    }
};

const ErrorHandler = {
    canHandle() {
        return true;
    },
    handle(handlerInput, error) {
        console.log(`~~~~ Erro tratado: ${JSON.stringify(error)}`);
        const speakOutput = 'Desculpe, ocorreu um erro ao processar sua solicitação. Por favor, tente novamente.';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

exports.handler = Alexa.SkillBuilders.custom()
    .addRequestHandlers(
        LaunchRequestHandler,
        RegistrarPressaoIntentHandler,
        EnviarResumoPressaoIntentHandler,
        HelpIntentHandler,
        CancelAndStopIntentHandler,
        FallbackIntentHandler,
        SessionEndedRequestHandler,
        IntentReflectorHandler)
    .addErrorHandlers(
        ErrorHandler)
    .withCustomUserAgent('sample/pressao-arterial/v1.0')
    .lambda();
