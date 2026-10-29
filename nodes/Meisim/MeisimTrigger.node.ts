import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { createHmac, timingSafeEqual } from 'crypto';

const digits10 = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-10);

async function baseUrl(ctx: IHookFunctions | IWebhookFunctions): Promise<string> {
	const cred = (await ctx.getCredentials('meisimApi')) as IDataObject;
	return String(cred.baseUrl || 'https://api.meisimusa.com').replace(/\/$/, '');
}

export class MeisimTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'MeiSIM USA Trigger',
		name: 'meisimTrigger',
		icon: 'file:meisim.svg',
		group: ['trigger'],
		version: 1,
		description: 'Starts the workflow the moment a text arrives on one of your MeiSIM numbers',
		defaults: { name: 'MeiSIM USA Trigger' },
		inputs: [],
		outputs: ['main'],
		credentials: [{ name: 'meisimApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					'Your MeiSIM account has one webhook address. Activating this trigger points it at n8n, and deactivating clears it. If something else already receives your texts, use the MeiSIM USA Poll Trigger instead.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Only This Number',
				name: 'number',
				type: 'string',
				default: '',
				placeholder: '2125551234',
				description: 'Leave empty to start on texts to every number of yours',
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const url = this.getNodeWebhookUrl('default');
				const base = await baseUrl(this);
				const r = (await this.helpers.httpRequestWithAuthentication.call(this, 'meisimApi', {
					method: 'GET',
					url: `${base}/api/v1/sms/webhook`,
					json: true,
				})) as IDataObject;
				const data = this.getWorkflowStaticData('node');
				return !!r && r.webhook_url === url && !!data.secret;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				const url = this.getNodeWebhookUrl('default');
				const base = await baseUrl(this);
				const r = (await this.helpers.httpRequestWithAuthentication.call(this, 'meisimApi', {
					method: 'POST',
					url: `${base}/api/v1/sms/webhook`,
					body: { webhook_url: url, format: 'meisim' },
					json: true,
				})) as IDataObject;
				const data = this.getWorkflowStaticData('node');
				data.secret = r.signing_secret || null;
				data.url = url;
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				const url = this.getNodeWebhookUrl('default');
				const base = await baseUrl(this);
				try {
					const cur = (await this.helpers.httpRequestWithAuthentication.call(this, 'meisimApi', {
						method: 'GET',
						url: `${base}/api/v1/sms/webhook`,
						json: true,
					})) as IDataObject;
					// Only clear what we set: somebody may have pointed the account elsewhere since.
					if (cur && cur.webhook_url === url) {
						await this.helpers.httpRequestWithAuthentication.call(this, 'meisimApi', {
							method: 'POST',
							url: `${base}/api/v1/sms/webhook`,
							body: { webhook_url: '' },
							json: true,
						});
					}
				} catch (_) {
					return false;
				}
				const data = this.getWorkflowStaticData('node');
				delete data.secret;
				delete data.url;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const res = this.getResponseObject();
		const body = this.getBodyData() as IDataObject;
		const data = this.getWorkflowStaticData('node');
		const secret = typeof data.secret === 'string' ? data.secret : '';

		// Every delivery is signed: X-MeiSIM-Signature is the hex HMAC-SHA256 of
		// the raw body under the secret we were given when the webhook was set.
		if (secret) {
			const rawBody = (req as unknown as { rawBody?: Buffer | string }).rawBody;
			const raw = rawBody ? Buffer.from(rawBody).toString('utf8') : JSON.stringify(body);
			const expect = createHmac('sha256', secret).update(raw).digest('hex');
			const got = String(req.headers['x-meisim-signature'] || '');
			const ok =
				got.length === expect.length && timingSafeEqual(Buffer.from(got), Buffer.from(expect));
			if (!ok) {
				res.status(401).send('bad signature');
				return { noWebhookResponse: true };
			}
		}

		const only = digits10(this.getNodeParameter('number', '') as string);
		if (only && digits10(body.number) !== only) {
			// Not the number this trigger watches: acknowledge, run nothing.
			return {};
		}

		return { workflowData: [this.helpers.returnJsonArray(body)] };
	}
}
