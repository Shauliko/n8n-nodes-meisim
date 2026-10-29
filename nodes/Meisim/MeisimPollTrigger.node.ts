import type {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';

const digits10 = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-10);

export class MeisimPollTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'MeiSIM USA Poll Trigger',
		name: 'meisimPollTrigger',
		icon: 'file:meisim.svg',
		group: ['trigger'],
		version: 1,
		polling: true,
		description:
			'Checks your MeiSIM numbers for new texts on a schedule. No webhook needed, so it leaves your account webhook alone.',
		defaults: { name: 'MeiSIM USA Poll Trigger' },
		inputs: [],
		outputs: ['main'],
		credentials: [{ name: 'meisimApi', required: true }],
		properties: [
			{
				displayName: 'Only This Number',
				name: 'number',
				type: 'string',
				default: '',
				placeholder: '2125551234',
				description: 'Leave empty to watch every number of yours',
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const data = this.getWorkflowStaticData('node');
		const cred = (await this.getCredentials('meisimApi')) as IDataObject;
		const base = String(cred.baseUrl || 'https://api.meisimusa.com').replace(/\/$/, '');
		const only = digits10(this.getNodeParameter('number', '') as string);

		const qs: IDataObject = { limit: 200 };
		if (only) qs.number = only;
		if (typeof data.lastAt === 'string' && data.lastAt) qs.since = data.lastAt;

		const r = (await this.helpers.httpRequestWithAuthentication.call(this, 'meisimApi', {
			method: 'GET',
			url: `${base}/api/v1/sms/messages`,
			qs,
			json: true,
		})) as IDataObject;
		const messages = (Array.isArray(r.messages) ? r.messages : []) as IDataObject[];

		// A manual run shows the latest texts without touching what the live
		// trigger remembers.
		if (this.getMode() === 'manual') {
			return messages.length ? [this.helpers.returnJsonArray(messages.slice(0, 5))] : null;
		}

		const newest = messages.reduce(
			(a, m) => (String(m.received_at || '') > a ? String(m.received_at) : a),
			typeof data.lastAt === 'string' ? data.lastAt : '',
		);

		// First poll after activation: remember where we are, emit nothing, so an
		// old inbox does not start a hundred runs at once.
		if (!data.lastAt) {
			data.lastAt = newest || new Date().toISOString();
			data.seenIds = messages.map((m) => String(m.id)).slice(0, 200);
			return null;
		}

		const seen = new Set(Array.isArray(data.seenIds) ? (data.seenIds as string[]) : []);
		const fresh = messages.filter((m) => !seen.has(String(m.id)));
		fresh.reverse(); // the API lists newest first; runs go oldest first
		data.lastAt = newest || data.lastAt;
		data.seenIds = [...fresh.map((m) => String(m.id)), ...seen].slice(0, 500);

		return fresh.length ? [this.helpers.returnJsonArray(fresh)] : null;
	}
}
