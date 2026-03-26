# pi-read-mode

Scroll through conversation history while composing a follow-up message. Solves the problem where typing in pi's composer snaps the terminal back to the bottom, losing your scroll position.

## Install

```bash
pi install npm:pi-read-mode
```

Or via git:

```bash
pi install git:github.com/minghinmatthewlam/pi-read-mode
```

## Features

- **Scroll + compose simultaneously** — read the agent's response while typing your follow-up
- **Pixel-perfect rendering** — captures pi's actual rendered output, not a reconstruction
- **Keyboard scrolling** — arrow keys, Page Up/Down, Home/End
- **Mouse/trackpad scrolling** — scroll wheel works in the viewport
- **Paste support** — text paste and image-to-filepath paste (via Ghostty/iTerm2)
- **Composer at bottom** — single-line input with Emacs-style editing

## Usage

| Key | Action |
|-----|--------|
| `Alt+R` | Enter read mode |
| `/read` | Enter read mode (slash command) |
| `Up` / `Down` | Scroll one line |
| `Page Up` / `Page Down` | Scroll one page |
| `Home` / `End` | Jump to top / bottom |
| `Enter` | Send follow-up message |
| `Escape` | Cancel and exit |

Read mode is available when the agent is idle. It captures the current conversation display and shows it in a scrollable viewport with a pinned composer.

## How it works

When you enter read mode, the extension captures pi's already-rendered TUI component tree by calling `render(width)` on the existing children. This produces the exact same ANSI-styled lines pi normally displays — no markdown reconstruction or custom rendering. The captured output is shown in a scrollable viewport with a composer pinned at the bottom. On terminal resize, components are re-rendered at the new width.

## License

MIT
