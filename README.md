# n8n-nodes-meisim

n8n nodes for [MeiSIM USA](https://www.meisimusa.com/api-for-ai-agents.html): real US mobile numbers on the T-Mobile network for AI agents, assistants and apps. Each number receives texts, sends texts, and takes and makes calls over SIP.

With these nodes a workflow can:

- start the moment a text arrives on one of your numbers (instant trigger, or a polling trigger);
- send a text from one of your numbers;
- read incoming texts, list your numbers, name a number, bind it to the people it may text;
- order new numbers, renew them, switch auto-renew, stop the daily rate;
- read your account and your SIP login.

## Install

In n8n: Settings, Community Nodes, Install, package name `n8n-nodes-meisim`.

Self-hosted from the command line:

```
npm install n8n-nodes-meisim
```

## Credentials

Create a MeiSIM USA API credential with your dealer API key. The key is on the API key tab of the [dealer dashboard](https://www.meisimusa.com/wholesale.html). The credential test calls `/api/v1/me`.

## Nodes

### MeiSIM USA

| Resource | Operations |
| --- | --- |
| Message | Send, Get Many |
| Line | Get Many, Update (label, allowed contacts), Renew, Set Auto-Renew, Stop or Resume Daily Charges |
| Order | Create, Get, Get Many |
| Account | Get, Get SIP Login, Get Webhook, Set Webhook, Clear Webhook |

### MeiSIM USA Trigger

Starts the workflow when a text arrives. Activating the workflow points your account's incoming-text webhook at n8n; deactivating clears it. Every delivery is signed (`X-MeiSIM-Signature`, HMAC-SHA256 of the body) and the node refuses anything that does not verify. One account has one webhook address, so if something else already receives your texts, use the poll trigger instead.

Each run receives one text:

```json
{ "event": "sms.received", "number": "2125550100", "from": "3105550199", "text": "hi", "received_at": "2026-10-29T20:00:00.000Z" }
```

### MeiSIM USA Poll Trigger

Checks for new texts on the schedule you set, without touching the account webhook. The first poll after activation only remembers where the inbox is, so an old inbox does not start a hundred runs at once.

## A texting agent in three nodes

1. MeiSIM USA Trigger
2. An AI agent node, with the incoming `text` as the prompt and `from` as the conversation key
3. MeiSIM USA, Message, Send: From Number `{{ $('MeiSIM USA Trigger').item.json.number }}`, To `{{ $('MeiSIM USA Trigger').item.json.from }}`, Text the agent's answer

## Good to know

- These lines are for one-to-one conversations. The same text to more than three numbers from one line inside an hour is refused, because carriers drop that pattern and the number can stay filtered afterwards.
- Sending answers `status: "accepted"`: the carrier took the text. Mobile lines have no delivery receipt.
- Allowed contacts bind a number to up to ten US numbers it may text. Incoming texts are never affected. Type `none` to clear the list.
- Numbers are prepaid and cannot be returned. A daily-rate number is stopped with Stop Daily Charges; a monthly number ends with its paid months unless renewed.
- Full API reference: [api-docs](https://www.meisimusa.com/api-docs.html).

## License

MIT. Support: support@meisimusa.com
