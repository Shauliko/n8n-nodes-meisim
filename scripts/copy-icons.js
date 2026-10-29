// Copies the node icons next to the compiled nodes; tsc leaves .svg behind.
const fs = require('fs');
const path = require('path');

function walk(dir, out = []) {
	for (const name of fs.readdirSync(dir)) {
		const p = path.join(dir, name);
		if (fs.statSync(p).isDirectory()) walk(p, out);
		else if (/\.(svg|png)$/i.test(name)) out.push(p);
	}
	return out;
}

const root = path.join(__dirname, '..');
for (const src of walk(path.join(root, 'nodes'))) {
	const dest = path.join(root, 'dist', path.relative(root, src));
	fs.mkdirSync(path.dirname(dest), { recursive: true });
	fs.copyFileSync(src, dest);
	console.log('icon:', path.relative(root, dest));
}
