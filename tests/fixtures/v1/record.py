# Records the v1 regression fixtures into this folder.
# Usage, from a checkout of tag v1:  python3 -m http.server 8767 &  python3 tests/fixtures/v1/record.py
import asyncio, base64, json, pathlib, sys
from playwright.async_api import async_playwright

HERE = pathlib.Path(__file__).parent
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8767/index.html'


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        page = await (await b.new_context()).new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.goto(URL)
        await page.wait_for_selector('text=New game')
        out = await page.evaluate("async () => (await import('/tests/fixtures/v1/record.js')).record()")
        await b.close()
    if errors:
        raise SystemExit(f'page errors: {errors}')
    if not out['replayMatches']:
        raise SystemExit('v1 replay of the log does not reach the final state')
    (HERE / 'game.jsonl').write_text(out['jsonl'])
    (HERE / 'final-state.json').write_text(json.dumps(out['finalState'], indent=1, sort_keys=True) + '\n')
    (HERE / 'sample-decks.mtgdecks').write_bytes(base64.b64decode(out['backupB64']))
    (HERE / 'records.json').write_text(json.dumps(out['records'], indent=1, sort_keys=True) + '\n')
    rejected = [r for r in out['results'] if not r['ok']]
    print('log entry kinds:', out['kinds'])
    print('command types:', len(out['commandTypes']), out['commandTypes'])
    print('notice kinds:', len(out['noticeKinds']), out['noticeKinds'])
    print('rejected:', [(r['type'], r['error']) for r in rejected])
    print('backup:', out['backupInfo'])
    print('v1 replay matches final state:', out['replayMatches'])


asyncio.run(main())
