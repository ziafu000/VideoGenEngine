const { CDPClient, listPages, sleep } = require('../engine/cdp');

async function main() {
  const pages = await listPages();
  const tiktokTab = pages.find(p => p.type === 'page' && p.url && p.url.includes('tiktok.com'));
  const client = new CDPClient(tiktokTab.webSocketDebuggerUrl);
  await client.ready;

  // Scroll down to check remaining videos
  const scroller = await client.evaluate(`(() => {
    const s = document.querySelector('.css-snthx, [class*="snthx"]');
    if (s) {
      s.scrollTop = s.scrollHeight;
      return { scrollTop: s.scrollTop, scrollHeight: s.scrollHeight };
    }
    return null;
  })()`);
  console.log('Scrolled to bottom:', scroller);
  await sleep(2000);

  const btns = await client.evaluate(`(() => {
    const list = Array.from(document.querySelectorAll('[data-tt="components_PrivacyCell_TUXButton"]'));
    return list.map(b => b.innerText?.trim());
  })()`);
  console.log('Buttons visible at bottom:', btns);

  // If any are Everyone, update them!
  const updatedCount = await client.evaluate(`(() => {
    const list = Array.from(document.querySelectorAll('[data-tt="components_PrivacyCell_TUXButton"]'));
    let count = 0;
    for (const btn of list) {
      if (btn.innerText?.trim() === 'Everyone') {
        const kFiber = Object.keys(btn).find(k => k.startsWith('__reactFiber'));
        let cur = btn[kFiber];
        while (cur) {
          if (cur.memoizedProps && cur.memoizedProps.options && cur.memoizedProps.onChange) {
            try {
              cur.memoizedProps.onChange({ value: 2 });
              count++;
              break;
            } catch (e) {}
          }
          cur = cur.return;
        }
      }
    }
    return count;
  })()`);
  console.log('Updated at bottom:', updatedCount);

  client.close();
}

main().catch(console.error);
