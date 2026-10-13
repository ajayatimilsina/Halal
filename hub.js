import { html, mountShell, icons } from './ui.js';
mountShell('ハラール食料品店');
const pages = [['customer', '買い物を始める', 'shopping-basket'], ['menu', '商品管理', 'package'], ['inventory', '棚卸', 'clipboard-list'], ['orders', '注文一覧', 'receipt-text'], ['shipping', '出荷', 'truck'], ['payment', '支払い設定', 'qr-code']];
document.querySelector('#app').innerHTML = html`<div class="hub">${pages.map(([page, label, icon]) => html`<a href="./${page}.html${location.search}"><i data-lucide="${icon}"></i>${html(label)}<i data-lucide="arrow-up-right"></i></a>`).join('')}</div><section class="section"><h2>名古屋市配達・全国発送</h2><p class="muted">名古屋市は商品代金 ¥10,000 以上で送料無料。全国発送は着払いです。</p></section>`;
icons();