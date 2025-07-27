deno run --allow-net --allow-read --watch serve.ts
deno run --allow-all npm:peggy -c peggy.config.mjs
deno bundle -o src/bundle/editor.js src/editor.ts
