const { anthropic } = await import('@workspace/integrations-anthropic-ai');
const t0 = Date.now();
const stream = anthropic.messages.stream({model:'claude-sonnet-4-5',max_tokens:600,messages:[{role:'user',content:'Who is the CEO of Tasama Business Services Company (Saudi Arabia)? One short sentence.'}],tools:[{type:'web_search_20250305',name:'web_search',max_uses:2}]});
for await (const ev of stream){ if(ev.type==='content_block_start') console.log(Date.now()-t0, ev.content_block.type); }
const m = await stream.finalMessage();
console.log('DONE', Date.now()-t0, JSON.stringify(m.content.filter(b=>b.type==='text').map(b=>b.text)).slice(0,300));
