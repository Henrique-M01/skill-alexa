# skill-alexa – Pressão Arterial

Skill da Alexa para monitoramento de pressão arterial em português (pt-BR).

## Funcionalidades

### Registrar pressão arterial
Diga:
> "Alexa, anote minha pressão arterial"

A Alexa solicitará os valores **sistólico** e **diastólico** (caso não sejam informados na frase). Após confirmação, a medição é salva em um arquivo JSON no Amazon S3 com data, hora e classificação automática (Normal, Elevada, Hipertensão Estágio 1 ou 2).

Você também pode informar os valores diretamente:
> "anote minha pressão arterial 120 por 80"

### Receber resumo por e-mail
Diga:
> "Alexa, me envie o resumo da pressão dos últimos 7 dias"

A skill irá filtrar todas as medições do período solicitado e enviar um e-mail HTML formatado com a tabela de registros via Amazon SES.

## Configuração

### Variáveis de ambiente (Lambda)

| Variável            | Descrição                                                    |
|---------------------|--------------------------------------------------------------|
| `S3_BUCKET_NAME`    | Nome do bucket S3 onde os registros são armazenados          |
| `EMAIL_DESTINATARIO`| Endereço de e-mail que receberá os resumos                   |
| `EMAIL_REMETENTE`   | Endereço de e-mail verificado no SES usado como remetente    |
| `SES_REGION`        | Região AWS do SES (padrão: `us-east-1`)                      |
| `TIMEZONE`          | Fuso horário para data/hora dos registros (padrão: `America/Sao_Paulo`) |

### Permissões IAM necessárias

A função Lambda precisa das seguintes permissões:
- `s3:GetObject` e `s3:PutObject` no bucket configurado
- `ses:SendEmail` na região configurada

## Estrutura do projeto

```
skill-alexa/
├── interactionModels/
│   └── custom/
│       └── pt-BR.json      # Modelo de interação em português
├── lambda/
│   ├── index.js            # Lógica principal da skill
│   ├── util.js             # Utilitários S3
│   └── package.json
└── skill.json              # Manifesto da skill
```

## Formato dos dados armazenados (S3)

Os registros são salvos em `pressao-arterial.json` com o seguinte formato:

```json
[
  {
    "data": "15/01/2024",
    "hora": "14:30:00",
    "sistolica": 120,
    "diastolica": 80,
    "timestamp": "2024-01-15T17:30:00.000Z"
  }
]
```
