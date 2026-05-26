const elements = {
  weekTitle: document.querySelector("#weekTitle"),
  weekRange: document.querySelector("#weekRange"),
  newEventTopButton: document.querySelector("#newEventTopButton"),
  authStatus: document.querySelector("#authStatus"),
  accountName: document.querySelector("#accountName"),
  signInLink: document.querySelector("#signInLink"),
  signOutButton: document.querySelector("#signOutButton"),
  newEventButton: document.querySelector("#newEventButton"),
  prevWeek: document.querySelector("#prevWeek"),
  nextWeek: document.querySelector("#nextWeek"),
  weekPicker: document.querySelector("#weekPicker"),
  daySchedule: document.querySelector("#daySchedule"),
  agendaList: document.querySelector("#agendaList"),
  agendaMeta: document.querySelector("#agendaMeta"),
  dayTemplate: document.querySelector("#dayTemplate"),
  eventSheet: document.querySelector("#eventSheet"),
  eventForm: document.querySelector("#eventForm"),
  closeEventSheet: document.querySelector("#closeEventSheet"),
  cancelEventButton: document.querySelector("#cancelEventButton"),
  eventTitle: document.querySelector("#eventTitle"),
  eventAllDay: document.querySelector("#eventAllDay"),
  eventStart: document.querySelector("#eventStart"),
  eventEnd: document.querySelector("#eventEnd"),
  eventDate: document.querySelector("#eventDate"),
  timedFields: document.querySelector("#timedFields"),
  allDayField: document.querySelector("#allDayField"),
  eventLocation: document.querySelector("#eventLocation"),
  eventDescription: document.querySelector("#eventDescription"),
  eventFormStatus: document.querySelector("#eventFormStatus"),
  saveEventButton: document.querySelector("#saveEventButton")
};

const today = startOfDay(new Date());
const defaultTimelineStartHour = 6;
const defaultTimelineEndHour = 22;
const timelineHourHeight = 54;

let visibleWeekStart = startOfWeek(today);
let selectedDate = today;
let events = createSampleEvents(today);
let activeEventKey = "";
let flippedEventKey = "";
let authState = {
  configured: false,
  signedIn: false,
  user: null
};

init();

elements.signOutButton.addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  authState = { ...authState, signedIn: false, user: null };
  events = createSampleEvents(today);
  elements.agendaMeta.textContent = "Signed out";
  renderAuth();
  render();
});

elements.newEventButton.addEventListener("click", () => {
  openEventSheet();
});

elements.newEventTopButton.addEventListener("click", () => {
  openEventSheet();
});

elements.closeEventSheet.addEventListener("click", () => {
  closeEventSheet();
});

elements.cancelEventButton.addEventListener("click", () => {
  closeEventSheet();
});

elements.eventAllDay.addEventListener("change", () => {
  syncAllDayFields();
});

elements.eventForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveGoogleEvent();
});

elements.prevWeek.addEventListener("click", async () => {
  visibleWeekStart = shiftDays(visibleWeekStart, -7);
  selectedDate = new Date(visibleWeekStart);
  if (authState.signedIn) {
    await loadGoogleEvents();
    return;
  }
  render();
});

elements.nextWeek.addEventListener("click", async () => {
  visibleWeekStart = shiftDays(visibleWeekStart, 7);
  selectedDate = new Date(visibleWeekStart);
  if (authState.signedIn) {
    await loadGoogleEvents();
    return;
  }
  render();
});

async function init() {
  await refreshAuthState();

  if (authState.signedIn) {
    await loadGoogleEvents();
    return;
  }

  render();
}

async function refreshAuthState() {
  try {
    const response = await fetch("/api/auth/me");
    authState = await response.json();
  } catch {
    authState = { configured: false, signedIn: false, user: null };
  }

  renderAuth();
}

function renderAuth() {
  elements.signInLink.hidden = authState.signedIn || !authState.configured;
  elements.signOutButton.hidden = !authState.signedIn;
  elements.newEventButton.hidden = !authState.signedIn;
  elements.newEventTopButton.hidden = !authState.signedIn;

  if (!authState.configured) {
    elements.authStatus.textContent = "Google setup needed";
    elements.accountName.textContent = "Add OAuth credentials to enable sign-in.";
    return;
  }

  if (authState.signedIn) {
    elements.authStatus.textContent = "Signed in";
    elements.accountName.textContent =
      authState.user?.email || authState.user?.name || "Google Calendar connected";
    return;
  }

  elements.authStatus.textContent = "Demo mode";
  elements.accountName.textContent = "Sign in to load and create Google Calendar events.";
}

async function loadGoogleEvents() {
  setStatus("Loading Google Calendar");

  try {
    const visibleWeek = getVisibleWeek();
    const timeMin = visibleWeek[0].toISOString();
    const timeMax = shiftDays(visibleWeek[6], 1).toISOString();
    const response = await fetch(
      `/api/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`
    );
    const payload = await parseResponseJson(response);

    if (!response.ok) {
      throw new Error(payload.error || "Could not load Google Calendar events.");
    }

    events = payload.events.map(normalizeServerEvent);
    elements.agendaMeta.textContent = `${events.length} Google events`;
    render();
  } catch (error) {
    events = [];
    setStatus(error.message);
    render();
  }
}

async function saveGoogleEvent() {
  elements.eventFormStatus.textContent = "Saving";
  elements.saveEventButton?.setAttribute("disabled", "");

  try {
    const allDay = elements.eventAllDay.checked;
    const payload = {
      title: elements.eventTitle.value,
      location: elements.eventLocation.value,
      description: elements.eventDescription.value,
      allDay,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    };

    if (allDay) {
      payload.date = elements.eventDate.value;
    } else {
      payload.start = toLocalIso(elements.eventStart.value);
      payload.end = toLocalIso(elements.eventEnd.value);
    }

    const response = await fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload)
    });
    const result = await parseResponseJson(response);

    if (!response.ok) {
      throw new Error(result.error || "Could not save the event.");
    }

    closeEventSheet();
    await loadGoogleEvents();
    elements.agendaMeta.textContent = "Event saved";
  } catch (error) {
    elements.eventFormStatus.textContent = error.message;
  } finally {
    elements.saveEventButton?.removeAttribute("disabled");
  }
}

function normalizeServerEvent(event) {
  return {
    ...event,
    start: event.allDay ? parseDateOnly(event.start) : new Date(event.start),
    end: event.allDay ? parseDateOnly(event.end) : new Date(event.end)
  };
}

function openEventSheet() {
  const start = new Date(selectedDate);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start);
  end.setHours(start.getHours() + 1);

  elements.eventForm.reset();
  elements.eventTitle.value = "";
  elements.eventStart.value = toDateTimeLocalValue(start);
  elements.eventEnd.value = toDateTimeLocalValue(end);
  elements.eventDate.value = toDateInputValue(selectedDate);
  elements.eventFormStatus.textContent = "";
  syncAllDayFields();
  elements.eventSheet.hidden = false;
  elements.eventTitle.focus();
}

function closeEventSheet() {
  elements.eventSheet.hidden = true;
}

function syncAllDayFields() {
  const allDay = elements.eventAllDay.checked;
  elements.timedFields.hidden = allDay;
  elements.allDayField.hidden = !allDay;
  elements.eventStart.required = !allDay;
  elements.eventEnd.required = !allDay;
  elements.eventDate.required = allDay;
}

function render() {
  const visibleWeek = getVisibleWeek();
  const start = visibleWeek[0];
  const end = visibleWeek[6];
  elements.weekTitle.textContent = getWeekTitle(start, end);
  elements.weekRange.textContent = getWeekRange(start, end);
  renderWeekPicker(visibleWeek);
  renderDaySchedule();
  renderAgenda();
}

function renderWeekPicker(visibleWeek) {
  elements.weekPicker.innerHTML = "";

  for (const date of visibleWeek) {
    const node = elements.dayTemplate.content.firstElementChild.cloneNode(true);
    const dots = node.querySelector(".event-dots");
    const dayEvents = eventsForDate(date).slice(0, 3);

    node.querySelector(".weekday-label").textContent = date.toLocaleDateString(undefined, {
      weekday: "short"
    });
    node.querySelector(".day-number").textContent = date.getDate();
    node.classList.toggle("is-today", isSameDate(date, today));
    node.classList.toggle("is-selected", isSameDate(date, selectedDate));
    node.setAttribute("aria-label", date.toDateString());

    for (const event of dayEvents) {
      const dot = document.createElement("span");
      dot.className = "event-dot";
      dot.title = event.title;
      dots.append(dot);
    }

    node.addEventListener("click", () => {
      selectedDate = date;
      render();
    });

    elements.weekPicker.append(node);
  }
}

function renderDaySchedule() {
  const dayEvents = eventsForDate(selectedDate).sort((a, b) => a.start - b.start);
  const allDayEvents = dayEvents.filter((event) => event.allDay);
  const timedEvents = dayEvents.filter((event) => !event.allDay);
  const timelineWindow = getTimelineWindow(timedEvents);
  const layoutEvents = layoutOverlappingEvents(timedEvents, timelineWindow);

  elements.daySchedule.innerHTML = "";

  const header = document.createElement("header");
  header.className = "schedule-header";
  header.innerHTML = `
    <div>
      <p class="schedule-day-name">${selectedDate.toLocaleDateString(undefined, { weekday: "long" })}</p>
      <h3>${selectedDate.toLocaleDateString(undefined, { month: "long", day: "numeric" })}</h3>
    </div>
    <span class="event-count">${dayEvents.length}</span>
  `;

  const allDayBand = document.createElement("div");
  allDayBand.className = "all-day-band";

  for (const event of allDayEvents) {
    const item = document.createElement("div");
    item.className = "all-day-event";
    item.innerHTML = `
      <strong>${escapeHtml(event.title || "Untitled event")}</strong>
      <span>All day</span>
    `;
    allDayBand.append(item);
  }

  const timeline = document.createElement("div");
  timeline.className = "timeline";
  timeline.style.setProperty("--hour-height", `${timelineHourHeight}px`);

  timeline.style.minHeight = `${(timelineWindow.endHour - timelineWindow.startHour) * timelineHourHeight}px`;

  for (let hour = timelineWindow.startHour; hour <= timelineWindow.endHour; hour += 1) {
    const label = document.createElement("span");
    label.className = "hour-label";
    label.style.top = `${(hour - timelineWindow.startHour) * timelineHourHeight}px`;
    label.textContent = formatHour(hour);
    timeline.append(label);
  }

  for (const event of layoutEvents) {
    const eventKey = getEventKey(event);
    const actionLinks = parseActionLinks(event.description || "");
    const hasActionLinks = Boolean(actionLinks.reschedule || actionLinks.cancel);
    const card = document.createElement("article");
    card.className = "timeline-event";
    card.classList.toggle("is-active", eventKey === activeEventKey);
    card.classList.toggle("is-flipped", eventKey === flippedEventKey);
    card.type = "button";
    card.tabIndex = 0;
    card.setAttribute("role", hasActionLinks ? "button" : "article");
    card.setAttribute("aria-label", hasActionLinks ? `Show actions for ${event.title || "Untitled event"}` : `Show ${event.title || "Untitled event"}`);
    card.style.top = `${event.top}px`;
    card.style.minHeight = `${getTimelineCardHeight(event)}px`;
    card.style.setProperty("--tier", String(event.tier));
    card.style.setProperty("--tier-count", String(event.tierCount));
    card.style.setProperty("--tier-offset", `${getTierOffset(event.tierCount)}px`);
    card.style.setProperty("--readable-rail", `${getReadableRail(event.tier, event.tierCount)}px`);
    card.style.setProperty("--text-width", `${getTextWidth(event.tier, event.tierCount)}px`);
    card.innerHTML = renderTimelineCard(event, actionLinks);
    card.addEventListener("click", () => {
      if (activeEventKey === eventKey && hasActionLinks) {
        flippedEventKey = flippedEventKey === eventKey ? "" : eventKey;
      } else {
        activeEventKey = eventKey;
        flippedEventKey = "";
      }
      renderDaySchedule();
    });
    for (const link of card.querySelectorAll("a")) {
      link.addEventListener("click", (linkEvent) => {
        linkEvent.stopPropagation();
      });
    }
    card.addEventListener("keydown", (keyboardEvent) => {
      if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
        keyboardEvent.preventDefault();
        if (activeEventKey === eventKey && hasActionLinks) {
          flippedEventKey = flippedEventKey === eventKey ? "" : eventKey;
        } else {
          activeEventKey = eventKey;
          flippedEventKey = "";
        }
        renderDaySchedule();
      }
    });
    timeline.append(card);
  }

  if (!timedEvents.length) {
    const empty = document.createElement("p");
    empty.className = "timeline-empty";
    empty.textContent = "No timed events on this day.";
    timeline.append(empty);
  }

  elements.daySchedule.append(header);
  if (allDayEvents.length) elements.daySchedule.append(allDayBand);
  elements.daySchedule.append(timeline);
}

function renderTimelineCard(event, actionLinks) {
  return `
    <div class="timeline-card-inner">
      <div class="timeline-card-face timeline-card-front">
        <strong>${escapeHtml(event.title || "Untitled event")}</strong>
        <span>${formatTime(event.start)} to ${formatTime(event.end)}</span>
        ${event.description ? `<p>${escapeHtml(cleanNote(event.description))}</p>` : ""}
      </div>
      <div class="timeline-card-face timeline-card-back">
        <strong>Manage appointment</strong>
        <div class="event-actions">
          ${actionLinks.reschedule ? `<a href="${escapeHtml(actionLinks.reschedule)}" target="_blank" rel="noopener">Reschedule</a>` : ""}
          ${actionLinks.cancel ? `<a href="${escapeHtml(actionLinks.cancel)}" target="_blank" rel="noopener">Cancel</a>` : ""}
        </div>
      </div>
    </div>
  `;
}

function renderAgenda() {
  const dayEvents = eventsForDate(selectedDate).sort((a, b) => a.start - b.start);
  elements.agendaList.innerHTML = "";

  if (!dayEvents.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Nothing scheduled for this day.";
    elements.agendaList.append(empty);
    return;
  }

  for (const event of dayEvents) {
    const card = document.createElement("article");
    card.className = "event-card";

    const time = document.createElement("div");
    time.className = "event-time";
    time.innerHTML = event.allDay
      ? "<span>All day</span>"
      : `<span>${formatTime(event.start)}</span><span>${formatTime(event.end)}</span>`;

    const detail = document.createElement("div");
    const title = document.createElement("p");
    title.className = "event-title";
    title.textContent = event.title || "Untitled event";
    detail.append(title);

    if (event.description) {
      const note = document.createElement("p");
      note.className = "event-note";
      note.textContent = cleanNote(event.description);
      detail.append(note);
    }

    if (event.location) {
      const location = document.createElement("p");
      location.className = "event-location";
      location.textContent = event.location;
      detail.append(location);
    }

    card.append(time, detail);
    elements.agendaList.append(card);
  }
}

function parseIcs(text) {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];

  return blocks
    .map((block) => {
      const fields = {};
      for (const rawLine of block.split(/\r?\n/)) {
        const separatorIndex = rawLine.indexOf(":");
        if (separatorIndex === -1) continue;

        const rawKey = rawLine.slice(0, separatorIndex);
        const value = rawLine.slice(separatorIndex + 1);
        const [name, ...params] = rawKey.split(";");
        fields[name] = {
          value: decodeIcs(value),
          params: Object.fromEntries(params.map((param) => param.split("=")))
        };
      }

      const start = parseIcsDate(fields.DTSTART);
      const end = parseIcsDate(fields.DTEND) || start;
      if (!start) return null;

      return {
        title: fields.SUMMARY?.value || "Untitled event",
        location: fields.LOCATION?.value || "",
        description: fields.DESCRIPTION?.value || "",
        start,
        end,
        allDay: fields.DTSTART?.params.VALUE === "DATE"
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
}

function parseIcsDate(field) {
  if (!field) return null;
  const value = field.value;

  if (field.params.VALUE === "DATE" || /^\d{8}$/.test(value)) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6)) - 1;
    const day = Number(value.slice(6, 8));
    return new Date(year, month, day);
  }

  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!match) return null;

  const [, year, month, day, hour, minute, second, zulu] = match;
  const parts = [year, month, day, hour, minute, second].map(Number);

  if (zulu) {
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]));
  }

  return new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
}

function decodeIcs(value) {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function createSampleEvents(baseDate) {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();

  return [
    {
      title: "Morning reset",
      location: "Kitchen table",
      start: new Date(year, month, baseDate.getDate(), 8, 30),
      end: new Date(year, month, baseDate.getDate(), 9, 0),
      allDay: false
    },
    {
      title: "Design review",
      location: "Studio",
      start: new Date(year, month, baseDate.getDate(), 13, 0),
      end: new Date(year, month, baseDate.getDate(), 14, 15),
      allDay: false
    },
    {
      title: "Client notes",
      location: "Desk",
      start: new Date(year, month, baseDate.getDate(), 13, 35),
      end: new Date(year, month, baseDate.getDate(), 15, 0),
      allDay: false
    },
    {
      title: "Quick sync",
      location: "Phone",
      start: new Date(year, month, baseDate.getDate(), 14, 0),
      end: new Date(year, month, baseDate.getDate(), 14, 40),
      allDay: false
    },
    {
      title: "Market day",
      location: "Downtown",
      start: new Date(year, month, baseDate.getDate() + 2),
      end: new Date(year, month, baseDate.getDate() + 3),
      allDay: true
    }
  ];
}

function eventsForDate(date) {
  return events.filter((event) => {
    const eventStart = startOfDay(event.start);
    const eventEnd = startOfDay(event.end);

    if (event.allDay && event.end > event.start) {
      eventEnd.setDate(eventEnd.getDate() - 1);
    }

    return date >= eventStart && date <= eventEnd;
  });
}

function isSameDate(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date) {
  const start = startOfDay(date);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function shiftDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function getVisibleWeek() {
  return Array.from({ length: 7 }, (_, index) => shiftDays(visibleWeekStart, index));
}

function getWeekTitle(start, end) {
  const sameMonth = start.getMonth() === end.getMonth();
  const sameYear = start.getFullYear() === end.getFullYear();

  if (sameMonth && sameYear) {
    return start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }

  if (sameYear) {
    return `${start.toLocaleDateString(undefined, { month: "short" })} / ${end.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;
  }

  return `${start.toLocaleDateString(undefined, { month: "short", year: "numeric" })} / ${end.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;
}

function getWeekRange(start, end) {
  return `${start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  })} to ${end.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  })}`;
}

function layoutOverlappingEvents(dayEvents, timelineWindow) {
  const dayStart = timelineWindow.startHour * 60;
  const dayEnd = timelineWindow.endHour * 60;
  const scheduled = dayEvents
    .map((event) => {
      const startMinutes = clamp(minutesIntoDay(event.start), dayStart, dayEnd);
      const endMinutes = clamp(minutesIntoDay(event.end), dayStart, dayEnd);
      return {
        ...event,
        startMinutes,
        endMinutes: Math.max(startMinutes + 20, endMinutes)
      };
    })
    .filter((event) => event.endMinutes > dayStart && event.startMinutes < dayEnd)
    .sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);

  const groups = [];
  let currentGroup = [];
  let currentEnd = -1;

  for (const event of scheduled) {
    if (!currentGroup.length || event.startMinutes < currentEnd) {
      currentGroup.push(event);
      currentEnd = Math.max(currentEnd, event.endMinutes);
    } else {
      groups.push(currentGroup);
      currentGroup = [event];
      currentEnd = event.endMinutes;
    }
  }

  if (currentGroup.length) groups.push(currentGroup);

  return groups.flatMap((group) => {
    const tierEnds = [];
    const arranged = group.map((event) => {
      let tier = tierEnds.findIndex((end) => end <= event.startMinutes);
      if (tier === -1) tier = tierEnds.length;
      tierEnds[tier] = event.endMinutes;
      return { ...event, tier };
    });
    const tierCount = Math.max(...arranged.map((event) => event.tier)) + 1;

    return arranged.map((event) => ({
      ...event,
      tierCount,
      top: ((event.startMinutes - dayStart) / 60) * timelineHourHeight,
      height: Math.max(
        42,
        ((event.endMinutes - event.startMinutes) / 60) * timelineHourHeight
      )
    }));
  });
}

function getTierOffset(tierCount) {
  if (tierCount <= 1) return 0;
  if (tierCount === 2) return 132;
  if (tierCount === 3) return 92;
  return 70;
}

function getReadableRail(tier, tierCount) {
  if (tier >= tierCount - 1) return 0;
  return Math.max(60, getTierOffset(tierCount) - 18);
}

function getTextWidth(tier, tierCount) {
  if (tier >= tierCount - 1) return 999;
  return Math.max(112, getReadableRail(tier, tierCount) - 12);
}

function getTimelineWindow(dayEvents) {
  if (!dayEvents.length) {
    return {
      startHour: defaultTimelineStartHour,
      endHour: defaultTimelineEndHour
    };
  }

  const earliestHour = Math.floor(
    Math.min(...dayEvents.map((event) => minutesIntoDay(event.start))) / 60
  );
  const latestHour = Math.ceil(
    Math.max(...dayEvents.map((event) => minutesIntoDay(event.end))) / 60
  );

  return {
    startHour: clamp(Math.min(defaultTimelineStartHour, earliestHour), 0, 23),
    endHour: clamp(Math.max(defaultTimelineEndHour, latestHour), 1, 24)
  };
}

function getTimelineCardHeight(event) {
  const note = cleanNote(event.description || "");
  if (!note) return event.height;

  const estimatedNoteLines = Math.max(1, Math.ceil(note.length / 30));
  const estimatedNoteHeight = estimatedNoteLines * 14;
  return Math.max(event.height, 42 + estimatedNoteHeight);
}

function getEventKey(event) {
  return [
    event.id || "",
    event.title || "",
    event.start instanceof Date ? event.start.toISOString() : String(event.start),
    event.end instanceof Date ? event.end.toISOString() : String(event.end)
  ].join("|");
}

function minutesIntoDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatHour(hour) {
  if (hour === 24) return "12 AM";
  const normalized = hour % 12 || 12;
  return `${normalized} ${hour < 12 ? "AM" : "PM"}`;
}

function parseDateOnly(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toDateTimeLocalValue(date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${toDateInputValue(date)}T${hours}:${minutes}`;
}

function toLocalIso(value) {
  const date = new Date(value);
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absoluteOffset / 60)).padStart(2, "0");
  const offsetRemainder = String(absoluteOffset % 60).padStart(2, "0");
  return `${value}:00${sign}${offsetHours}:${offsetRemainder}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cleanNote(value) {
  const plainText = String(value).replace(/<[^>]*>/g, "");
  const [visibleNote] = plainText.split(/={3,}/);
  return visibleNote.replace(/\s+/g, " ").trim();
}

function parseActionLinks(value) {
  const plainText = String(value).replace(/<[^>]*>/g, " ");
  return {
    reschedule: findLabeledUrl(plainText, "Reschedule"),
    cancel: findLabeledUrl(plainText, "Cancel")
  };
}

function findLabeledUrl(value, label) {
  const match = value.match(new RegExp(`${label}\\s*:-?\\s*(https?:\\/\\/\\S+)`, "i"));
  return match?.[1]?.trim() || "";
}

function formatTime(date) {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit"
  });
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function parseResponseJson(response) {
  const text = await response.text();
  const payload = safeJson(text);
  return payload || { error: text || response.statusText };
}

function setStatus(message) {
  elements.agendaMeta.textContent = message;
}
