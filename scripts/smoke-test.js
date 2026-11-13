#!/usr/bin/env node
// Loads the compiled nodes the way n8n would, checks the descriptions, and
// runs the two triggers against a stand-in for n8n's context: a signed
// delivery, a forged one, the number filter, and a polling cycle.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');
const { MeisimApi } = require(path.join(dist, 'credentials', 'MeisimApi.credentials.js'));
const { Meisim } = require(path.join(dist, 'nodes', 'Meisim', 'Meisim.node.js'));
const { MeisimTrigger } = require(path.join(dist, 'nodes', 'Meisim', 'MeisimTrigger.node.js'));
const { MeisimPollTrigger } = require(path.join(dist, 'nodes', 'Meisim', 'MeisimPollTrigger.node.js'));

let n = 0;
const ok = (cond, name) => { n++; assert.ok(cond, name); };

// ── descriptions ─────────────────────────────────────────────────────────────
const cred = new MeisimApi();
ok(cred.name === 'meisimApi' && cred.authenticate.properties.headers['x-dealer-key'], 'credential sends x-dealer-key');
ok(cred.test.request.url === '/api/v1/me', 'credential test hits /api/v1/me');

const node = new Meisim().description;
ok(node.name === 'meisim' && node.credentials[0].name === 'meisimApi', 'node is wired to the credential');
const ops = node.properties.filter((p) => p.name === 'operation');
const opNames = ops.flatMap((p) => p.options.map((o) => o.value));
for (const want of ['send', 'getAll', 'update', 'renew', 'autoRenew', 'dailyStop', 'create', 'get', 'getSip', 'setWebhook', 'clearWebhook']) {
	ok(opNames.includes(want), 'operation ' + want);
}
const send = ops.find((p) => p.displayOptions.show.resource[0] === 'message').options.find((o) => o.value === 'send');
ok(/\/api\/v1\/sms\/lines\/\{\{.*\}\}\/send$/.test(send.routing.request.url) && send.routing.request.method === 'POST', 'send posts to the line');
const bodyProps = node.properties.filter((p) => p.routing && p.routing.send && p.routing.send.type === 'body').map((p) => p.routing.send.property);
ok(bodyProps.includes('to') && bodyProps.includes('message') && bodyProps.includes('count') && bodyProps.includes('webhook_url'), 'body fields route');
ok(node.properties.every((p) => !/—/.test(JSON.stringify(p))), 'no em dashes in the UI text');
for (const p of node.properties) if (p.name === 'limit') ok(p.description === 'Max number of results to return', 'limit description as n8n wants it');
ok(node.usableAsTool === true, 'an AI agent node can use it as a tool');
ok(node.inputs.join() === 'main' && node.outputs.join() === 'main', 'one main input and one main output');

// Every icon a node or the credential names is a file in the package, light and dark.
const iconFile = (fromFile, ref) => path.join(path.dirname(fromFile), String(ref).replace(/^file:/, ''));
const iconOwners = [
	[path.join(dist, 'credentials', 'MeisimApi.credentials.js'), cred.icon],
	[path.join(dist, 'nodes', 'Meisim', 'Meisim.node.js'), node.icon],
	[path.join(dist, 'nodes', 'Meisim', 'MeisimTrigger.node.js'), new MeisimTrigger().description.icon],
	[path.join(dist, 'nodes', 'Meisim', 'MeisimPollTrigger.node.js'), new MeisimPollTrigger().description.icon],
];
for (const [file, icon] of iconOwners) {
	ok(icon && /^file:/.test(icon.light) && /^file:/.test(icon.dark), 'light and dark icon named in ' + path.basename(file));
	for (const ref of [icon.light, icon.dark]) {
		const f = iconFile(file, ref);
		ok(fs.existsSync(f) && /<svg/.test(fs.readFileSync(f, 'utf8')), 'icon file is in the package: ' + path.relative(dist, f));
	}
}
// Where each node sits in n8n's panel and where its docs are.
for (const name of ['Meisim', 'MeisimTrigger', 'MeisimPollTrigger']) {
	const codex = JSON.parse(fs.readFileSync(path.join(dist, 'nodes', 'Meisim', name + '.node.json'), 'utf8'));
	ok(codex.categories[0] === 'Communication' && /^https:\/\/github\.com\/Shauliko\/n8n-nodes-meisim/.test(codex.resources.primaryDocumentation[0].url), name + ' has its panel entry');
}
// What the package tells n8n to load is what the build made.
const pkg = require(path.join(__dirname, '..', 'package.json'));
for (const f of [...pkg.n8n.nodes, ...pkg.n8n.credentials]) ok(fs.existsSync(path.join(__dirname, '..', f)), 'listed in package.json and built: ' + f);
ok(pkg.n8n.strict === true && !pkg.dependencies, 'strict mode on, no run-time dependencies');
const uiText = JSON.stringify([node, new MeisimTrigger().description, new MeisimPollTrigger().description, cred.properties]);
ok(!/—/.test(uiText) && !/\bzap/i.test(uiText), 'no em dash and no other product named in any UI text');

// ── instant trigger ──────────────────────────────────────────────────────────
const trig = new MeisimTrigger();
ok(trig.description.webhooks[0].httpMethod === 'POST' && trig.description.polling === undefined, 'instant trigger is a webhook node');
ok(/number/.test(trig.description.subtitle) && trig.description.outputs.join() === 'main' && trig.description.inputs.length === 0, 'instant trigger has a subtitle, no input, one output');

function webhookCtx({ body, secret, signature, number = '' }) {
	const raw = JSON.stringify(body);
	let status = 0, sent = null;
	const res = { status(s) { status = s; return res; }, send(b) { sent = b; return res; } };
	const staticData = { secret };
	return {
		ctx: {
			getRequestObject: () => ({ rawBody: Buffer.from(raw), headers: { 'x-meisim-signature': signature } }),
			getResponseObject: () => res,
			getBodyData: () => body,
			getWorkflowStaticData: () => staticData,
			getNodeParameter: (name, dflt) => (name === 'number' ? number : dflt),
			helpers: { returnJsonArray: (d) => (Array.isArray(d) ? d : [d]).map((json) => ({ json })) },
		},
		result: () => ({ status, sent }),
		raw,
	};
}
const secret = 'test-secret';
const body = { event: 'sms.received', number: '2125550100', from: '3105550199', text: 'hi', received_at: '2026-10-29T20:00:00Z' };
const good = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');

(async () => {
	let c = webhookCtx({ body, secret, signature: good });
	let out = await trig.webhook.call(c.ctx);
	ok(out.workflowData && out.workflowData[0][0].json.text === 'hi', 'a signed delivery starts the workflow');

	c = webhookCtx({ body, secret, signature: good.replace(/^./, (ch) => (ch === 'a' ? 'b' : 'a')) });
	out = await trig.webhook.call(c.ctx);
	ok(out.noWebhookResponse === true && c.result().status === 401, 'a forged delivery is refused with 401');

	c = webhookCtx({ body, secret, signature: good, number: '+1 (212) 555-0100' });
	out = await trig.webhook.call(c.ctx);
	ok(out.workflowData && out.workflowData[0].length === 1, 'the number filter matches with any formatting');

	c = webhookCtx({ body, secret, signature: good, number: '2125550199' });
	out = await trig.webhook.call(c.ctx);
	ok(!out.workflowData && !out.noWebhookResponse, 'another number is acknowledged and not run');

	// webhook lifecycle against a fake API: each workflow its own subscription
	// (POST/GET/DELETE /api/v1/sms/webhooks), the main webhook as the fallback.
	const api = { multi: true, down: false, webhook_url: null, subs: [], calls: [], n: 0 };
	const httpError = (status, code) => Object.assign(new Error('HTTP ' + status), { httpCode: String(status), cause: { response: { status, data: { code } } } });
	const logs = [];
	const hookCtx = (url, number = '') => ({
		getNode: () => ({ id: 't1', name: 'MeiSIM USA Trigger', type: 'n8n-nodes-meisim.meisimTrigger', typeVersion: 1, position: [0, 0], parameters: {} }),
		logger: { warn: (m) => logs.push(String(m)) },
		getNodeWebhookUrl: () => url,
		getNodeParameter: (name, dflt) => (name === 'number' ? number : dflt),
		getCredentials: async () => ({ apiKey: 'k', baseUrl: 'https://api.example.test/' }),
		getWorkflowStaticData: () => hookCtx.data,
		helpers: {
			httpRequestWithAuthentication: async function (_cred, opts) {
				api.calls.push(opts.method + ' ' + opts.url + ' ' + JSON.stringify(opts.body || {}));
				const path = opts.url.replace('https://api.example.test', '');
				if (api.down) throw httpError(500, 'server_error');
				if (path.startsWith('/api/v1/sms/webhooks')) {
					if (!api.multi) throw httpError(503, 'NOT_ENABLED');
					if (opts.method === 'GET') return { ok: true, enabled: true, webhooks: api.subs.map((x) => ({ id: x.id, webhook_url: x.url, number: x.number })) };
					if (opts.method === 'POST') {
						const sub = { id: 'sub-' + ++api.n, url: opts.body.webhook_url, number: opts.body.number || null, source: opts.body.source };
						api.subs.push(sub);
						return { ok: true, id: sub.id, webhook_url: sub.url, signing_secret: 'sec-' + sub.id };
					}
					if (opts.method === 'DELETE') {
						const id = decodeURIComponent(path.split('/').pop());
						const before = api.subs.length;
						api.subs = api.subs.filter((x) => x.id !== id);
						if (api.subs.length === before) throw httpError(404, 'not_found');
						return { ok: true, deleted: true, id };
					}
				}
				if (opts.method === 'GET') return { ok: true, webhook_url: api.webhook_url };
				api.webhook_url = opts.body.webhook_url || null;
				return { ok: true, webhook_url: api.webhook_url, signing_secret: api.webhook_url ? 'sec-main' : null };
			},
		},
	});
	const h = trig.webhookMethods.default;
	hookCtx.data = {};
	ok((await h.checkExists.call(hookCtx('https://n8n.test/webhook/1'))) === false, 'nothing registered yet');
	ok((await h.create.call(hookCtx('https://n8n.test/webhook/1', '+1 212 555 0100'))) === true && hookCtx.data.subId === 'sub-1' && hookCtx.data.secret === 'sec-sub-1', 'create makes its own subscription and keeps its secret');
	ok(api.subs[0].source === 'n8n' && api.subs[0].number === '2125550100', 'the subscription says n8n and carries the number filter');
	ok(api.webhook_url === null, 'the main webhook is left alone');
	ok((await h.checkExists.call(hookCtx('https://n8n.test/webhook/1'))) === true, 'then it exists');
	const first = hookCtx.data;
	hookCtx.data = {};
	ok((await h.create.call(hookCtx('https://n8n.test/webhook/2'))) === true && api.subs.length === 2, 'a second workflow gets a second subscription, the first is kept');
	hookCtx.data = first;
	ok((await h.delete.call(hookCtx('https://n8n.test/webhook/1'))) === true && api.subs.length === 1 && api.subs[0].url === 'https://n8n.test/webhook/2' && !hookCtx.data.subId, 'delete removes only its own subscription');
	hookCtx.data = { subId: 'sub-gone', secret: 's' };
	ok((await h.delete.call(hookCtx('https://n8n.test/webhook/9'))) === true, 'a subscription already gone (404) is not an error');

	// the API failing for another reason: activation says so, deactivation logs it
	api.down = true;
	hookCtx.data = {};
	let thrown = null;
	try { await h.create.call(hookCtx('https://n8n.test/webhook/7')); } catch (e) { thrown = e; }
	ok(thrown && thrown.constructor.name === 'NodeApiError' && !hookCtx.data.subId && !hookCtx.data.secret, 'a failing API stops activation with an n8n API error, nothing is remembered');
	ok(!api.calls.some((x) => x.includes('/api/v1/sms/webhook {"webhook_url":"https://n8n.test/webhook/7"')), 'and it does not fall back to the main webhook');
	hookCtx.data = { subId: 'sub-2', secret: 's', url: 'https://n8n.test/webhook/2' };
	logs.length = 0;
	ok((await h.delete.call(hookCtx('https://n8n.test/webhook/2'))) === false && hookCtx.data.subId === 'sub-2' && logs.length === 1 && /could not be removed/.test(logs[0]), 'a failing API on deactivation is logged, and the subscription is still remembered');
	api.down = false;
	ok((await h.delete.call(hookCtx('https://n8n.test/webhook/2'))) === true && api.subs.length === 0 && !hookCtx.data.subId, 'the next deactivation removes it');

	// before the account side is switched on: the main webhook, as in 0.1.0
	api.multi = false;
	hookCtx.data = {};
	ok((await h.create.call(hookCtx('https://n8n.test/webhook/3'))) === true && !hookCtx.data.subId && hookCtx.data.secret === 'sec-main', 'NOT_ENABLED falls back to the main webhook');
	ok(api.calls.some((x) => x.startsWith('POST https://api.example.test/api/v1/sms/webhook {"webhook_url":"https://n8n.test/webhook/3","format":"meisim"}')), 'the fallback posts the n8n URL in meisim format');
	ok((await h.checkExists.call(hookCtx('https://n8n.test/webhook/3'))) === true, 'the fallback exists');
	api.webhook_url = 'https://elsewhere.test/hook';
	ok((await h.delete.call(hookCtx('https://n8n.test/webhook/3'))) === true && api.webhook_url === 'https://elsewhere.test/hook', 'delete leaves a main webhook somebody else set');
	api.webhook_url = 'https://n8n.test/webhook/3';
	hookCtx.data = { secret: 'sec-main' };
	ok((await h.delete.call(hookCtx('https://n8n.test/webhook/3'))) === true && api.webhook_url === null && !hookCtx.data.secret, 'delete clears our own main webhook and the secret');

	// ── poll trigger ───────────────────────────────────────────────────────────
	const poll = new MeisimPollTrigger();
	ok(poll.description.polling === true && !poll.description.webhooks, 'poll trigger is a polling node');
	ok(/number/.test(poll.description.subtitle) && poll.description.outputs.join() === 'main', 'poll trigger has a subtitle and one output');
	const inbox = [
		{ id: 'm3', to: '2125550100', from: '1', text: 'three', otp: null, received_at: '2026-10-29T20:03:00Z' },
		{ id: 'm2', to: '2125550100', from: '1', text: 'two', otp: null, received_at: '2026-10-29T20:02:00Z' },
		{ id: 'm1', to: '2125550100', from: '1', text: 'one', otp: null, received_at: '2026-10-29T20:01:00Z' },
	];
	const pollCtx = (mode) => ({
		getWorkflowStaticData: () => pollCtx.data,
		getCredentials: async () => ({ apiKey: 'k', baseUrl: 'https://api.example.test' }),
		getNodeParameter: () => '',
		getMode: () => mode,
		helpers: {
			httpRequestWithAuthentication: async function (_cred, opts) {
				pollCtx.lastQs = opts.qs;
				const since = opts.qs.since ? String(opts.qs.since) : '';
				return { ok: true, messages: inbox.filter((m) => !since || m.received_at > since) };
			},
			returnJsonArray: (d) => (Array.isArray(d) ? d : [d]).map((json) => ({ json })),
		},
	});
	pollCtx.data = {};
	let r = await poll.poll.call(pollCtx('manual'));
	ok(r && r[0].length === 3 && !pollCtx.data.lastAt, 'a manual run shows the latest texts and remembers nothing');
	ok(r[0].every((x) => x.json.event === 'sms.received' && x.json.number === '2125550100' && x.json.to === '2125550100' && x.json.id), 'a polled text has event and number like an instant delivery, and keeps what the API sent');
	r = await poll.poll.call(pollCtx('trigger'));
	ok(r === null && pollCtx.data.lastAt === '2026-10-29T20:03:00Z', 'first live poll remembers the newest and emits nothing');
	r = await poll.poll.call(pollCtx('trigger'));
	ok(r === null && pollCtx.lastQs.since === '2026-10-29T20:03:00Z', 'nothing new: asks since the newest, emits nothing');
	inbox.unshift({ id: 'm5', to: '2125550100', from: '1', text: 'five', otp: null, received_at: '2026-10-29T20:05:00Z' });
	inbox.unshift({ id: 'm4', to: '2125550100', from: '1', text: 'four', otp: null, received_at: '2026-10-29T20:04:00Z' });
	// keep newest-first order as the API does
	inbox.sort((a, b) => (a.received_at < b.received_at ? 1 : -1));
	r = await poll.poll.call(pollCtx('trigger'));
	ok(r && r[0].map((x) => x.json.text).join(',') === 'four,five', 'new texts come out oldest first');
	// The fields the readme's three-node agent reads are on both triggers' items.
	const deliveryKeys = Object.keys(body);
	ok(deliveryKeys.every((k) => k in r[0][0].json), 'every field of an instant delivery is on a polled text too: ' + deliveryKeys.join(', '));
	r = await poll.poll.call(pollCtx('trigger'));
	ok(r === null, 'and are not emitted twice');

	console.log(`smoke-test: ${n} checks passed`);
})().catch((e) => { console.error('smoke-test failed:', e.message); process.exit(1); });
