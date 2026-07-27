/**
 * Writes the generated OpenAPI document to docs/openapi.json.
 *
 * The server already serves the same document at /api/openapi.json; this dumps
 * it to a file for tooling that wants it on disk — spec linting, client
 * generation, or diffing the contract in review. Run `npm run docs:openapi`.
 */
import fs from 'fs';
import path from 'path';
import { discoverRoutes } from '../src/app';
import { buildOpenApiSpec } from '../src/openapi/spec';

const outFile = path.join(process.cwd(), 'docs', 'openapi.json');
const routes = discoverRoutes();
const spec = buildOpenApiSpec(routes);

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `${JSON.stringify(spec, null, 2)}\n`, 'utf-8');

console.log(`[openapi] ${routes.length} operations → ${path.relative(process.cwd(), outFile)}`);
