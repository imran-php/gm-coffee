'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../js/core.js');
const ctx = { window: {} }; vm.createContext(ctx);
for (const name of ['config', 'menu']) vm.runInContext(fs.readFileSync(path.join(__dirname, `../js/${name}.js`),'utf8'),ctx);
const config = JSON.parse(JSON.stringify(ctx.window.GM_CONFIG));
const menu = JSON.parse(JSON.stringify(ctx.window.GM_MENU));
const products = menu.products;
let passed = 0;
function test(title, fn) { fn(); passed++; console.log(`✓ ${title}`); }
const capp = { id:'milk-coffee-01', variant:'0', qty:1 };
test('64 products, 9 categories',()=>{assert.equal(products.length,64);assert.equal(menu.categories.length,9);});
test('Unique stable product IDs',()=>assert.equal(new Set(products.map(p=>p.id)).size,64));
test('All prices match source right column',()=>{
 const source=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/menu-source.json'),'utf8'));
 for(const cat of source.categories)for(const item of cat.items){
  const p=products.find(p=>p.id===item.id);assert.deepEqual(p.variants.map(v=>v.price),item.source_price_column);
 }
});
test('All product image files exist',()=>products.forEach(p=>assert.ok(fs.existsSync(path.join(__dirname,'..',p.image)))));
test('Prices are nonnegative integer rubles',()=>products.forEach(p=>p.variants.forEach(v=>assert.ok(Number.isSafeInteger(v.price)&&v.price>=0))));
test('Single-price positions have no invented volume',()=>products.filter(p=>p.variants.length===1).forEach(p=>assert.equal(p.variants[0].volumeMl,null)));
test('Strawberry ambiguity is explicitly flagged',()=>assert.equal(products.find(p=>p.id==='cocktails-04').priceNeedsReview,true));
test('iiko mapping is not falsely populated',()=>products.forEach(p=>assert.equal(p.iikoProductId,null)));
test('Demo mode / inactive integrations',()=>{assert.equal(config.mode,'demo');assert.equal(config.iiko.connected,false);assert.equal(config.payment.connected,false)});
test('Empty cart has no delivery fee',()=>{const t=C.totals([],products,config);assert.equal(t.total,0);assert.equal(t.delivery,0);});
test('One 240-ruble drink + 149 delivery = 389',()=>assert.equal(C.totals([capp],products,config).total,389));
test('350 ml variant uses 280, not 240',()=>assert.equal(C.totals([{...capp,variant:'1'}],products,config).subtotal,280));
test('Pickup has no delivery fee',()=>assert.equal(C.totals([capp],products,config,'pickup').total,240));
test('Below threshold uses delivery fee',()=>assert.equal(C.totals([{...capp,qty:4}],products,config).total,1109));
test('Exact threshold gives free delivery',()=>{
 const basket=[{id:'cocktails-01',variant:'0',qty:1},{id:'cold-coffee-01',variant:'0',qty:2}];
 const t=C.totals(basket,products,config);assert.equal(t.subtotal,1000);assert.equal(t.delivery,0);assert.equal(t.remaining,0);
});
test('Over threshold gives free delivery',()=>assert.equal(C.totals([{...capp,qty:5}],products,config).delivery,0));
test('Duplicate same-size lines merge',()=>assert.equal(C.sanitizeCart([capp,capp],products)[0].qty,2));
test('Different sizes remain distinct',()=>assert.equal(C.sanitizeCart([capp,{...capp,variant:'1'}],products).length,2));
test('Unknown product / size safely removed',()=>assert.equal(C.sanitizeCart([{id:'fake',variant:'0',qty:1},{...capp,variant:'999'}],products).length,0));
test('Invalid, fractional, negative or string quantity rejected',()=>assert.equal(C.sanitizeCart([null,{},false,{...capp,qty:-1},{...capp,qty:1.5},{...capp,qty:'2'}],products).length,0));
test('Quantity is capped at 20 per variant',()=>assert.equal(C.sanitizeCart([{...capp,qty:999}],products)[0].qty,20));
test('Total basket capped at 100',()=>assert.equal(C.sanitizeCart(products.slice(0,10).map(p=>({id:p.id,variant:'0',qty:20})),products).reduce((s,l)=>s+l.qty,0),100));
test('Modified client price field is ignored by calculation',()=>assert.equal(C.totals([{...capp,price:1}],products,config).subtotal,240));
test('Cyrillic search normalizes ё/е and case',()=>{assert.equal(C.search(products,menu.categories,'ЗЕЛЕНКА')[0].sourceName,'Зелёнка');assert.equal(C.search(products,menu.categories,'КАПУЧИНО').length,1);});
test('Bubble Tea category includes exactly 7 positions',()=>assert.equal(C.search(products,menu.categories,'','bubble-tea').length,7));
test('Unknown query returns empty',()=>assert.equal(C.search(products,menu.categories,'неизвестный напиток xyz').length,0));
test('Favorites intersect category and query',()=>assert.equal(C.search(products,menu.categories,'','all',['milk-coffee-01']).length,1));
test('Phone validation, including demo phone',()=>{assert.ok(C.validPhone('+7 (000) 000-00-00'));assert.ok(C.validPhone('89374500000'));assert.equal(C.validPhone('123'),false);});
test('UI escaping prevents injected markup',()=>assert.equal(C.escape('<img x="y">&'), '&lt;img x=&quot;y&quot;&gt;&amp;'));
test('Configurable minimum order respected',()=>assert.equal(C.totals([capp],products,{...config,delivery:{...config.delivery,minOrder:500}}).minReached,false));
console.log(`\n${passed} tests passed.`);
