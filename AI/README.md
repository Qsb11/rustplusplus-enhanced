# AI Knowledge Folder

Documents in this folder are retrieved by the `!ai` / `/ai` assistant.

How it works:
- Drop `.md`, `.txt` or `.json` files anywhere in this folder (subfolders fine).
- When a question comes in, files are scored by keyword overlap and the top
  matches are injected into the AI prompt (truncated to ~2500 chars each).
- Live game data (craft costs, recycle yields, research costs, raid/durability
  tables) is injected automatically from `src/staticFiles/` — you do NOT need
  to duplicate per-item data here.

Use this folder for knowledge the item database cannot express:
- electricity circuit designs
- base building patterns
- raiding strategy and meta
- monument puzzle guides
- server-specific notes

Keep files focused: one topic per file, descriptive filename (filenames are
part of the keyword match).
