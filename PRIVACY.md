# Axonix privacy policy

Last updated: 9 October 2026

Axonix is a desktop app for one person. It runs on your own Windows computer. There is no Axonix
server and no Axonix account, and the app has no analytics, advertising or tracking in it.

## Google Calendar

Connecting Google Calendar is optional. If you connect it, you sign in with Google in your browser,
through a Google Cloud OAuth client that you create yourself. Axonix asks for three permissions:

- to see the list of your calendars;
- to read the events on your calendars;
- to create one calendar named "Axonix", and to add, change and delete events on that calendar only.

Axonix cannot change or delete an event on any other calendar.

**What the data is used for.** Your events are shown beside your tasks. The time you block for a task
in Axonix is kept as an event on the "Axonix" calendar, and a change made on either side is carried
to the other.

**Where it is kept.** All of it stays on your computer:

- the sign-in (a refresh token) and your OAuth client ID and secret, in Windows Credential Manager;
- a copy of recent events and the state of the sync, in files in the app's data folder
  (`%LOCALAPPDATA%\Axonix`).

Calendar data travels between your computer and Google, and nowhere else, with one exception that is
yours to choose:

**Assistants.** Axonix can be used with an AI assistant: the one built into it, which runs on your own
ChatGPT sign-in, or an AI tool on your computer that you let in through Axonix's local door. Neither
works until you set it up yourself. If you ask one of them about your calendar, the titles, times and
places of the events on the days you asked about are sent to the AI service you connected, so that it
can answer. That service handles them under its own terms.

Axonix itself does not sell your data, show ads, share it with anyone else, or train models on it.

**Removing it.** "Disconnect" in Axonix's Google Calendar panel withdraws Axonix's access at Google,
deletes the stored sign-in and deletes the cached events. You can also remove Axonix at any time at
<https://myaccount.google.com/permissions>. The "Axonix" calendar and its events stay in your Google
account until you delete them there.

Axonix's use of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements.

## Everything else in Axonix

Your tasks, notes, finance records and saved references are files on your computer. Axonix does not
upload them. As with the calendar, parts of them are sent to an AI service only when you ask an
assistant that you connected yourself.

The Social module shows websites such as Instagram, X and Reddit inside the app. Those sites handle
what you do on them under their own policies.

## Questions

Open an issue at <https://github.com/madhavsonkusare-a11y/axonix-template/issues>.
