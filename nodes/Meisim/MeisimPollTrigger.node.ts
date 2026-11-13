import {
	NodeConnectionTypes,
	type IDataObject,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type IPollFunctions,
} from 'n8n-workflow';

const digits10 = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-10);

// A text from the API's list, in the shape the instant trigger gives: the
// number that received it is `number` (the list calls it `to`) and `event`
// says what happened. Everything the API returned stays on the item.
const asDelivery = (m: IDataObject): IDataObject => ({
	event: 'sms.received',
	number: m.to ?? m.number,
	...m,
});

export class MeisimPollTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'MeiSIM USA Poll Trigger',
		name: 'meisimPollTrigger',
		icon: { light: 'file:../../icons/meisim.svg', dark: 'file:../../icons/meisim.dark.svg' },
		group: ['trigger'],
		version: 1,
		polling: true,
		subtitle: '={{ $parameter["number"] ? "Texts to " + $parameter["number"] : "Texts to every number" }}',
		description:
			'Checks your MeiSIM numbers for new texts on a schedule. No webhook needed, so it leaves your account webhook alone.',
		defaults: { name: 'MeiSIM USA Poll Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
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
		const manual = this.getMode() === 'manual';

		// The remembered position belongs to the filter it was taken under. A
		// position saved before the filter was remembered keeps its filter.
		const savedAt = typeof data.lastAt === 'string' ? data.lastAt : '';
		if (!manual && savedAt && data.filter === undefined) data.filter = only;
		// Start over on the first poll after activation, and when "Only This
		// Number" was changed since: the texts already sitting on the numbers now
		// watched are not new, and must not start a hundred runs at once.
		const startOver = !manual && (!savedAt || data.filter !== only);

		const qs: IDataObject = { limit: 200 };
		if (only) qs.number = only;
		if (savedAt && !startOver) qs.since = savedAt;

		const r = (await this.helpers.httpRequestWithAuthentication.call(this, 'meisimApi', {
			method: 'GET',
			url: `${base}/api/v1/sms/messages`,
			qs,
			json: true,
		})) as IDataObject;
		const messages = (Array.isArray(r.messages) ? r.messages : []) as IDataObject[];

		// A manual run shows the latest texts without touching what the live
		// trigger remembers.
		if (manual) {
			return messages.length
				? [this.helpers.returnJsonArray(messages.slice(0, 5).map(asDelivery))]
				: null;
		}

		const newest = messages.reduce(
			(a, m) => (String(m.received_at || '') > a ? String(m.received_at) : a),
			startOver ? '' : savedAt,
		);

		// Remember where the inbox is and emit nothing.
		if (startOver) {
			data.lastAt = newest || new Date().toISOString();
			data.seenIds = messages.map((m) => String(m.id)).slice(0, 200);
			data.filter = only;
			return null;
		}

		const seen = new Set(Array.isArray(data.seenIds) ? (data.seenIds as string[]) : []);
		const fresh = messages.filter((m) => !seen.has(String(m.id)));
		fresh.reverse(); // the API lists newest first; runs go oldest first
		data.lastAt = newest || savedAt;
		data.seenIds = [...fresh.map((m) => String(m.id)), ...seen].slice(0, 500);

		return fresh.length ? [this.helpers.returnJsonArray(fresh.map(asDelivery))] : null;
	}
}
