# Follow-ups

Follow-ups are work for a later thread. While an agent works on what you asked, it often spots something else that needs doing: a bug on the way, a test it left out, a refactor that would help. Instead of doing it now or only mentioning it, the agent adds a follow-up, and you start a thread from it when you're ready.

Every agent can add them: Claude Code and the ACP agents (Gemini CLI, Copilot CLI, OpenCode and custom agents). You can add them too (see [Adding one yourself](#adding-one-yourself)). Follow-ups belong to a project, and every thread in that project sees a new one at once, whatever branch it is on.

## Opening the list

Click the list icon in the sidebar footer, next to bookmarks (it is on the rail too when the sidebar is folded). The number on it is how many follow-ups are open across your projects (a removed project's aren't counted). The list opens beside the thread you're in, or beside a new thread or the landing screen. Press `Esc` or the **✕** to close it.

Follow-ups are grouped by project, highest [priority](#priority) first, then oldest first, so ones of the same priority stay in the order they came up. Each shows what to do, when it was added, the thread that added it (click its name to open it, if the thread is still open), and the details the agent wrote for the next thread. Long details fold to four lines; **Show more** opens them.

## Priority

Each follow-up is **High**, **Normal** or **Low**. The agent that adds one picks it: high for something broken that people will hit, a security or data-loss risk, or work that blocks other work; low for tidying and nice-to-haves; normal for the rest. Follow-ups saved before there were priorities are normal. If an agent adds one that is already listed, with a higher priority, the listed one's priority goes up (never down), so an agent can say the work became more pressing. High ones have an amber edge, here and on the board.

To change one, click its priority (next to **Delete** here, or on the right of its card on the board) and pick another.

## Adding one yourself

Click **+** at the top of the list (or in the board's Follow-ups column) to open **New follow-up**. Write what needs doing, and if you like the details a thread with none of your context needs to start: where, why, and what done looks like. Pick its **Priority** (it starts at **Normal**). With more than one project, pick the one it belongs to (it starts in the project of the thread you're in). Click **Add follow-up**, or press `Ctrl+Enter` in the details. **Cancel** or `Esc` closes it without adding anything.

One you add works like an agent's: start a thread from it, and that thread's agent marks it done. If the project already has an open follow-up with the same title, Grove Bench says so and doesn't add it twice.

## On the board

With **Board (alpha)** on, the board's first column, **Follow-ups**, shows the same open follow-ups beside your threads (see [Board](sidebar.md#board-alpha)). Its **+** adds one, **Start thread** and **Done** work as they do here, and a follow-up leaves the column while a thread started from it is open: that thread's card stands for it, and names the follow-up along its bottom. Click that line to open this list at the follow-up, shown in full. If the thread is closed before the work is done, the follow-up comes back, marked **Started before**, with **Start another**.

## Starting a thread from one

Click **Start thread**. The new thread opens in the follow-up's project with the follow-up as its first message: the title, the details and a line naming the follow-up, so the agent knows to mark it done. Pick the agent, model and branch as usual, change the message if you like, then send it.

If you are already writing a new thread, Grove Bench shows that one instead and leaves your message as it is. Send or discard it, then start the follow-up.

Once the thread starts, the follow-up says **Started in** with a link to it, and the button becomes **Start another**.

## Marking one done

When the thread's agent finishes the work, it marks the follow-up done and says what it did. You can also click **Done** yourself. Done follow-ups fold under **Show done** in each project, with the note the agent left and the thread that did the work. **Reopen** puts one back on the list. Grove Bench keeps the 50 most recent done follow-ups in each project.

**Delete** removes a follow-up for good.

## What agents are told

Each new thread is told what follow-ups are, when to add one (work outside what you asked for in that thread), and to write the details so a thread with none of its context can start on them. It is also given the titles of up to ten open follow-ups in its project, highest priority first, so it doesn't add one twice and can mark one done if its work finishes it. High and low ones say so, and titles a thread was started from are marked as possibly in progress. Because other agents wrote them, the titles are marked as notes, not instructions. It is told not to start on a follow-up unless you ask.

Agents use three tools from Grove Bench's `grove-followups` server: `followup_add`, `followup_list` and `followup_done`. `followup_add` takes the priority, with what each one is for. `followup_list` lists them highest priority first, with the first 200 characters of each one's details; given an id, it shows that one in full. They run without asking you, like the memory tools, because they only change Grove Bench's own list. In the Thread tab's Summary view, adding a follow-up and marking one done stay in view.

A project can have up to 100 open follow-ups. They are saved in `follow-ups.json` in Grove Bench's app data folder, not in your project, so they aren't committed or shared with your team.
