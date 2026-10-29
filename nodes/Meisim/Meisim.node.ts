import type { INodeType, INodeTypeDescription } from 'n8n-workflow';

// A number as the API wants it: ten digits, no +1, no punctuation.
const NUMBER_IN_URL = '{{ $parameter["number"].toString().replace(/\\D/g, "").slice(-10) }}';

export class Meisim implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'MeiSIM USA',
		name: 'meisim',
		icon: 'file:meisim.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description:
			'Real US mobile numbers for AI agents and apps: send and read texts, manage your lines, order numbers',
		defaults: { name: 'MeiSIM USA' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'meisimApi', required: true }],
		requestDefaults: {
			baseURL: '={{ $credentials.baseUrl }}',
			headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
		},
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Account', value: 'account' },
					{ name: 'Line', value: 'line' },
					{ name: 'Message', value: 'message' },
					{ name: 'Order', value: 'order' },
				],
				default: 'message',
			},

			// ── Message ────────────────────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['message'] } },
				options: [
					{
						name: 'Send',
						value: 'send',
						action: 'Send a text',
						description:
							'Send a text from one of your numbers to a 10-digit US number or a 5 or 6 digit short code',
						routing: {
							request: { method: 'POST', url: `=/api/v1/sms/lines/${NUMBER_IN_URL}/send` },
						},
					},
					{
						name: 'Get Many',
						value: 'getAll',
						action: 'Get many texts',
						description: 'Incoming texts on your numbers, newest first',
						routing: {
							request: { method: 'GET', url: '/api/v1/sms/messages' },
							output: {
								postReceive: [{ type: 'rootProperty', properties: { property: 'messages' } }],
							},
						},
					},
				],
				default: 'send',
			},
			{
				displayName: 'From Number',
				name: 'number',
				type: 'string',
				required: true,
				default: '',
				placeholder: '2125551234',
				description: 'One of your MeiSIM numbers, 10 digits',
				displayOptions: { show: { resource: ['message'], operation: ['send'] } },
			},
			{
				displayName: 'To',
				name: 'to',
				type: 'string',
				required: true,
				default: '',
				placeholder: '3105551234',
				description: 'A 10-digit US number, or a 5 or 6 digit short code',
				displayOptions: { show: { resource: ['message'], operation: ['send'] } },
				routing: { send: { type: 'body', property: 'to' } },
			},
			{
				displayName: 'Text',
				name: 'text',
				type: 'string',
				required: true,
				default: '',
				typeOptions: { rows: 3 },
				description:
					'What to send. These lines are for one-to-one conversations: the same text to several numbers inside an hour is refused.',
				displayOptions: { show: { resource: ['message'], operation: ['send'] } },
				routing: { send: { type: 'body', property: 'message' } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1 },
				description: 'Max number of results to return',
				displayOptions: { show: { resource: ['message'], operation: ['getAll'] } },
				routing: { send: { type: 'query', property: 'limit' } },
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { resource: ['message'], operation: ['getAll'] } },
				options: [
					{
						displayName: 'Number',
						name: 'number',
						type: 'string',
						default: '',
						description: 'Only texts received on this number of yours',
						routing: { send: { type: 'query', property: 'number' } },
					},
					{
						displayName: 'Since',
						name: 'since',
						type: 'dateTime',
						default: '',
						description: 'Only texts received after this time',
						routing: { send: { type: 'query', property: 'since' } },
					},
				],
			},

			// ── Line ───────────────────────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['line'] } },
				options: [
					{
						name: 'Get Many',
						value: 'getAll',
						action: 'Get many lines',
						description: 'Your numbers with their status, end date and settings',
						routing: {
							request: { method: 'GET', url: '/api/v1/sms/lines' },
							output: {
								postReceive: [{ type: 'rootProperty', properties: { property: 'lines' } }],
							},
						},
					},
					{
						name: 'Update',
						value: 'update',
						action: 'Update a line',
						description: 'Name a number, or bind it to the people it may text',
						routing: { request: { method: 'PATCH', url: `=/api/v1/sms/lines/${NUMBER_IN_URL}` } },
					},
					{
						name: 'Renew',
						value: 'renew',
						action: 'Renew a line',
						description: 'Add months to a monthly number, charged to your wallet',
						routing: {
							request: { method: 'POST', url: `=/api/v1/sms/lines/${NUMBER_IN_URL}/renew` },
						},
					},
					{
						name: 'Set Auto-Renew',
						value: 'autoRenew',
						action: 'Set auto renew on a line',
						description: 'Take the next term from your wallet shortly before the number would stop',
						routing: {
							request: { method: 'POST', url: `=/api/v1/sms/lines/${NUMBER_IN_URL}/auto-renew` },
						},
					},
					{
						name: 'Stop Daily Charges',
						value: 'dailyStop',
						action: 'Stop the daily charges on a line',
						description: 'A daily-rate number works through its last paid day and then stops',
						routing: {
							request: {
								method: 'POST',
								url: `=/api/v1/sms/lines/${NUMBER_IN_URL}/daily-stop`,
								body: { stop: true },
							},
						},
					},
					{
						name: 'Resume Daily Charges',
						value: 'dailyResume',
						action: 'Resume the daily charges on a line',
						description: 'Undo a stop before the last paid day',
						routing: {
							request: {
								method: 'POST',
								url: `=/api/v1/sms/lines/${NUMBER_IN_URL}/daily-stop`,
								body: { stop: false },
							},
						},
					},
				],
				default: 'getAll',
			},
			{
				displayName: 'Number',
				name: 'number',
				type: 'string',
				required: true,
				default: '',
				placeholder: '2125551234',
				description: 'One of your MeiSIM numbers, 10 digits',
				displayOptions: {
					show: {
						resource: ['line'],
						operation: ['update', 'renew', 'autoRenew', 'dailyStop', 'dailyResume'],
					},
				},
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1 },
				description: 'Max number of results to return',
				displayOptions: { show: { resource: ['line'], operation: ['getAll'] } },
				routing: { send: { type: 'query', property: 'limit' } },
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['line'], operation: ['getAll'] } },
				options: [
					{
						displayName: 'Offset',
						name: 'offset',
						type: 'number',
						default: 0,
						description: 'Skip this many lines (for paging)',
						routing: { send: { type: 'query', property: 'offset' } },
					},
					{
						displayName: 'Search',
						name: 'q',
						type: 'string',
						default: '',
						description: 'Match on the number, the label or your order reference',
						routing: { send: { type: 'query', property: 'q' } },
					},
				],
			},
			{
				displayName: 'Update Fields',
				name: 'updateFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['line'], operation: ['update'] } },
				options: [
					{
						displayName: 'Allowed Contacts',
						name: 'allowedContacts',
						type: 'string',
						default: '',
						placeholder: '2125551234, 3105551234',
						description:
							'Comma-separated 10-digit US numbers this line may text, up to 10. Type "none" to allow everyone again. Incoming texts are never affected.',
						routing: {
							send: {
								type: 'body',
								property: 'allowed_contacts',
								value:
									'={{ $value.trim().toLowerCase() === "none" ? [] : $value.split(",").map(s => s.replace(/\\D/g, "").slice(-10)).filter(s => s.length === 10) }}',
							},
						},
					},
					{
						displayName: 'Label',
						name: 'label',
						type: 'string',
						default: '',
						description: 'A name for the number, up to 60 characters',
						routing: { send: { type: 'body', property: 'label' } },
					},
				],
			},
			{
				displayName: 'Months',
				name: 'months',
				type: 'number',
				default: 1,
				typeOptions: { minValue: 1, maxValue: 12 },
				description: 'Months to add from the current end date',
				displayOptions: { show: { resource: ['line'], operation: ['renew'] } },
				routing: { send: { type: 'body', property: 'months' } },
			},
			{
				displayName: 'Auto-Renew',
				name: 'autoRenew',
				type: 'boolean',
				default: true,
				description: 'Whether the next term is taken from your wallet automatically',
				displayOptions: { show: { resource: ['line'], operation: ['autoRenew'] } },
				routing: { send: { type: 'body', property: 'auto_renew' } },
			},

			// ── Order ──────────────────────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['order'] } },
				options: [
					{
						name: 'Create',
						value: 'create',
						action: 'Order numbers',
						description: 'Buy one or more numbers, paid from your wallet',
						routing: { request: { method: 'POST', url: '/api/v1/sms/order' } },
					},
					{
						name: 'Get',
						value: 'get',
						action: 'Get an order',
						description: 'One order with its numbers',
						routing: {
							request: { method: 'GET', url: '=/api/v1/sms/orders/{{ $parameter["orderId"] }}' },
						},
					},
					{
						name: 'Get Many',
						value: 'getAll',
						action: 'Get many orders',
						description: 'Your number orders, newest first',
						routing: {
							request: { method: 'GET', url: '/api/v1/sms/orders' },
							output: {
								postReceive: [{ type: 'rootProperty', properties: { property: 'orders' } }],
							},
						},
					},
				],
				default: 'create',
			},
			{
				displayName: 'Order ID',
				name: 'orderId',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['order'], operation: ['get'] } },
			},
			{
				displayName: 'Count',
				name: 'count',
				type: 'number',
				required: true,
				default: 1,
				typeOptions: { minValue: 1, maxValue: 500 },
				description: 'How many numbers',
				displayOptions: { show: { resource: ['order'], operation: ['create'] } },
				routing: { send: { type: 'body', property: 'count' } },
			},
			{
				displayName: 'Billing',
				name: 'billing',
				type: 'options',
				options: [
					{ name: 'Monthly', value: 'monthly' },
					{ name: 'Daily Rate', value: 'daily' },
				],
				default: 'monthly',
				description: 'Monthly pays months up front; the daily rate is charged day by day from your wallet',
				displayOptions: { show: { resource: ['order'], operation: ['create'] } },
				routing: { send: { type: 'body', property: 'billing' } },
			},
			{
				displayName: 'Months',
				name: 'months',
				type: 'number',
				default: 2,
				typeOptions: { minValue: 1, maxValue: 12 },
				description: 'Months paid up front (2 minimum unless your account allows single months)',
				displayOptions: { show: { resource: ['order'], operation: ['create'], billing: ['monthly'] } },
				routing: { send: { type: 'body', property: 'months' } },
			},
			{
				displayName: 'Line History',
				name: 'lineHistory',
				type: 'options',
				options: [
					{
						name: 'Fresh',
						value: 'fresh',
						description:
							'A number never used before, bought new from the carrier: 2 months minimum, no refund if the carrier blocks it',
					},
					{
						name: 'Any',
						value: 'any',
						description: 'A number from stock, which may have been used before',
					},
				],
				default: 'any',
				displayOptions: { show: { resource: ['order'], operation: ['create'], billing: ['monthly'] } },
				routing: { send: { type: 'body', property: 'line_history' } },
			},
			{
				displayName: 'Voice',
				name: 'voice',
				type: 'boolean',
				default: false,
				description: 'Whether the numbers take and make calls over SIP (when voice is open on your account)',
				displayOptions: { show: { resource: ['order'], operation: ['create'] } },
				routing: { send: { type: 'body', property: 'voice' } },
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['order'], operation: ['create'] } },
				options: [
					{
						displayName: 'Area Code',
						name: 'areaCode',
						type: 'string',
						default: '',
						placeholder: '718',
						routing: { send: { type: 'body', property: 'area_code' } },
					},
					{
						displayName: 'Auto-Renew',
						name: 'autoRenew',
						type: 'boolean',
						default: false,
						description: 'Whether to take the next term from your wallet automatically',
						routing: { send: { type: 'body', property: 'auto_renew' } },
					},
					{
						displayName: 'Customer Reference',
						name: 'customerReference',
						type: 'string',
						default: '',
						description:
							'Your own reference, up to 120 characters. Repeating an order with the same reference orders nothing twice.',
						routing: { send: { type: 'body', property: 'customer_reference' } },
					},
					{
						displayName: 'ZIP Code',
						name: 'zipCode',
						type: 'string',
						default: '',
						placeholder: '11201',
						routing: { send: { type: 'body', property: 'zip_code' } },
					},
				],
			},

			// ── Account ────────────────────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['account'] } },
				options: [
					{
						name: 'Clear Webhook',
						value: 'clearWebhook',
						action: 'Clear the incoming text webhook',
						description: 'Stop pushing incoming texts to a URL',
						routing: { request: { method: 'POST', url: '/api/v1/sms/webhook', body: { webhook_url: '' } } },
					},
					{
						name: 'Get',
						value: 'get',
						action: 'Get the account',
						description: 'Who the key belongs to and the daily line limit',
						routing: { request: { method: 'GET', url: '/api/v1/me' } },
					},
					{
						name: 'Get SIP Login',
						value: 'getSip',
						action: 'Get the SIP login',
						description: 'The SIP login every voice number of yours registers with',
						routing: { request: { method: 'GET', url: '/api/v1/sms/sip' } },
					},
					{
						name: 'Get Webhook',
						value: 'getWebhook',
						action: 'Get the incoming text webhook',
						description: 'Where incoming texts are pushed, if anywhere',
						routing: { request: { method: 'GET', url: '/api/v1/sms/webhook' } },
					},
					{
						name: 'Set Webhook',
						value: 'setWebhook',
						action: 'Set the incoming text webhook',
						description:
							'Push every incoming text to an HTTPS URL, signed with HMAC-SHA256. The signing secret is returned once.',
						routing: {
							request: { method: 'POST', url: '/api/v1/sms/webhook', body: { format: 'meisim' } },
						},
					},
				],
				default: 'get',
			},
			{
				displayName: 'Webhook URL',
				name: 'webhookUrl',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'https://example.com/incoming-text',
				description: 'HTTPS only. Every delivery carries X-MeiSIM-Signature, the hex HMAC-SHA256 of the raw body.',
				displayOptions: { show: { resource: ['account'], operation: ['setWebhook'] } },
				routing: { send: { type: 'body', property: 'webhook_url' } },
			},
		],
	};
}
