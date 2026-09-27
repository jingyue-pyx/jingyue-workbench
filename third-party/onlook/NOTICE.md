# Onlook source attribution

Source: https://github.com/onlook-dev/onlook
Revision: 423e2e924366419e418ee049093872d535eea41a
License: Apache-2.0; complete license retained alongside this notice.

`app/lib/visual/onlook-text.ts` adapts the text updater from
`packages/parser/src/code-edit/text.ts` and the class updater from
`packages/parser/src/code-edit/style.ts`. Imports were changed to Babel standalone;
the surrounding adapter restricts edits to supported static JSX elements.

The element locator, preview bridge and editor panel are integration code written
for this project. The full Onlook application, backend, collaboration, drag-and-drop
canvas and cloud sandbox are NOT incorporated. Bolt remains the host application.
