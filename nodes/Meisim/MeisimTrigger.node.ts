import {
	NodeApiError,
	NodeConnectionTypes,
	type IDataObject,
	type IHookFunctions,
	type INodeType,
	type INodeTypeDescription,
	type IWebhookFunctions,
	type IWebhookResponseData,
	type JsonObject,
} from 'n8n-workflow';
import { createHmac, timingSafeEqual } from 'crypto';

const digits10 = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-10);

async function baseUrl(ctx: IHookFunctions | IWebhookFunctions): Promise<string> {
	const cred = (await ctx.getCredentials('meisimApi')) as IDataObject;
	return String(cred.baseUrl || 'https://api.meisimusa.com').replace(/\/$/, '');
}

// The status and API error code of a failed call, whichever shape n8n's
// request helper wrapped them in.
function errorInfo(e: unknown): { status: number | null; code: string | null } {
	const x = e as {
		httpCode?: string | number;
		statusCode?: number;
		response?: { status?: number; data?: { code?: string } };
		cause?: { response?: { status?: number; data?: { code?: string } } };
		description?: unknown;
	};
	const status =
		Number(x?.httpCode) || x?.statusCode || x?.response?.status || x?.cause?.response?.status || null;
	const code = x?.response?.data?.code || x?.cause?.response?.data?.code || null;
	return { status: status ? Number(status) : null, code: code ? String(code) : null };
}

// EACH WORKFLOW ITS OWN SUBSCRIPTION (2026-11-04). POST /api/v1/sms/webhooks
// adds this workflow's address next to the account's other webhooks, with its
// own signing secret, and deactivating removes it by id. Before, every
// workflow shared the account's one webhook, so the newest replaced the
// others. Until the account side is switched on (503 NOT_ENABLED, or 404 from an
// older API) the trigger falls back to the account's main webhook.
export class MeisimTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'MeiSIM USA Trigger',
		name: 'meisimTrigger',
		icon: { light: 'file:../../icons/meisim.svg', dark: 'file:../../icons/meisim.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{ $parameter["number"] ? "Texts to " + $parameter["number"] : "Texts to every number" }}',
		description: 'Starts the workflow the moment a text arrives on one of your MeiSIM numbers',
		defaults: { name: 'MeiSIM USA Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
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
					'Each workflow with this trigger gets its own delivery address on your MeiSIM account, so several workflows and your own system can all receive your texts. Deactivating the workflow removes its address.',
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
				const data = this.getWorkflowStaticData('node');
				if (!data.secret) return false;
				if (data.subId) {
					const r = (await this.helpers.httpRequestWithAuthentication.call(this, 'meisimApi', {
						method: 'GET',
						url: `${base}/api/v1/sms/webhooks`,
						json: true,
					})) as IDataObject;
					const list = (Array.isArray(r?.webhooks) ? r.webhooks : []) as IDataObject[];
					return list.some((w) => w.id === data.subId && w.webhook_url === url);
				}
				const r = (await this.helpers.httpRequestWithAuthentication.call(this, 'meisimApi', {
					method: 'GET',
					url: `${base}/api/v1/sms/webhook`,
					json: true,
				})) as IDataObject;
				return !!r && r.webhook_url === url;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				const url = this.getNodeWebhookUrl('default');
				const base = await baseUrl(this);
				const data = this.getWorkflowStaticData('node');
				const number = digits10(this.getNodeParameter('number', '') as string);
				try {
					const r = (await this.helpers.httpRequestWithAuthentication.call(this, 'meisimApi', {
						method: 'POST',
						url: `${base}/api/v1/sms/webhooks`,
						body: { webhook_url: url, source: 'n8n', ...(number.length === 10 ? { number } : {}) },
						json: true,
					})) as IDataObject;
					data.subId = r.id || null;
					data.secret = r.signing_secret || null;
					data.url = url;
					return true;
				} catch (e) {
					const { status, code } = errorInfo(e);
					if (code !== 'NOT_ENABLED' && status !== 503 && status !== 404) {
						throw new NodeApiError(this.getNode(), e as JsonObject);
					}
				}
				const r = (await this.helpers.httpRequestWithAuthentication.call(this, 'meisimApi', {
					method: 'POST',
					url: `${base}/api/v1/sms/webhook`,
					body: { webhook_url: url, format: 'meisim' },
					json: true,
				})) as IDataObject;
				delete data.subId;
				data.secret = r.signing_secret || null;
				data.url = url;
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				const url = this.getNodeWebhookUrl('default');
				const base = await baseUrl(this);
				const data = this.getWorkflowStaticData('node');
				try {
					if (data.subId) {
						try {
							await this.helpers.httpRequestWithAuthentication.call(this, 'meisimApi', {
								method: 'DELETE',
								url: `${base}/api/v1/sms/webhooks/${encodeURIComponent(String(data.subId))}`,
								json: true,
							});
						} catch (e) {
							// Already gone: nothing left to undo.
							if (errorInfo(e).status !== 404) {
								throw new NodeApiError(this.getNode(), e as JsonObject);
							}
						}
					} else {
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
					}
				} catch (error) {
					// n8n goes on deactivating either way; the log says the address is still there.
					this.logger.warn(
						`MeiSIM USA Trigger: the delivery address could not be removed (${(error as Error).message})`,
					);
					return false;
				}
				delete data.subId;
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
