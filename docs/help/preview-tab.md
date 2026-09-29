# Preview Tab

The Preview tab (`Alt+5`) is a browser inside each conversation. Use it to look at your app while the agent works on it, and to watch the agent check its own work.

## Two pages

Each conversation has two pages. Switch between them with **Yours** and **Claude's** at the top left of the tab.

- **Yours** is a normal browser page you click around in. It opens any web address, and files inside the conversation's worktree, such as a built HTML page.
- **Claude's** is the page the agent drives with its browser tools. You see it update as the agent opens pages, clicks and types. It's view only. **Open in yours** loads the same address in your page.

The two pages share cookies and storage, so signing in on one signs in the other. Each conversation's storage is separate from other conversations and is cleared when the conversation closes.

## Opening a page

- Type in the address bar (`Ctrl+L`). `3000` opens `http://localhost:3000/`, `localhost:5173/login` works without `http://`, and a Windows path like `C:\repo\index.html` opens the file
- Click a localhost link in the conversation (in agent output, markdown or the Terminal tab). `Ctrl+click` opens it in your system browser instead
- When a dev server prints its address in the Terminal tab or in the agent's output, the address shows up in the empty Preview tab. Click it to open it

The toolbar has back, forward, reload, **Open in system browser** and **Developer tools**. Right-click the page for copy, paste, back, reload and **Inspect Element**.

When a page can't load, the tab says why. For example, a refused connection usually means the dev server isn't running.

## Keys inside the page

| Shortcut | Action |
|----------|--------|
| `F5` or `Ctrl+R` | Reload |
| `Ctrl+F5` or `Ctrl+Shift+R` | Reload without the cache |
| `F12` or `Ctrl+Shift+I` | Developer tools |
| `Alt+Left` / `Alt+Right` | Back / forward |
| `Ctrl+L` or `Alt+D` | Go to the address bar |
| `Alt+1` to `Alt+5`, `Alt+M`, `Alt+T`, `Alt+E`, `Ctrl+B`, `Ctrl+N`, `Ctrl+Shift+T` | Grove Bench shortcuts, as usual |

`Ctrl+R` reloads the page while the page has focus. Elsewhere in Grove Bench it still opens the conversation finder.

## The agent's browser

The agent can open a local page, take a screenshot, read the page's text, click, type and read console errors and failed network requests. Ask for it in plain words, for example "start the dev server and check the signup form in the preview".

- It only opens local addresses (`localhost`, `127.0.0.1`, `[::1]`) and HTML files in the conversation's worktree. Links and redirects to other sites are blocked
- Opening, screenshots, reading and logs run without asking. Clicking and typing ask for permission like other actions. **Always allow** stops asking for that action (for example every click) for the rest of the conversation
- If the page shows an alert or a confirm box, it's answered OK unless the agent asked for Cancel, and the agent is told what it said
- Files load only from the conversation's worktree, and the agent's page only loads web files (HTML, CSS, scripts, images, fonts, media)
- A dot on the Preview tab means the agent used its browser since you last looked
- The page is 1280×800 unless the agent picks another size, for example a phone size

Turn the agent's browser off under **Settings > General > Let the agent use the Preview browser**. The change applies to agents started after it.

Pages show on screen only while the Preview tab is open. When a Grove Bench menu or dialog opens over your page, a still picture of the page stands in until it closes.
