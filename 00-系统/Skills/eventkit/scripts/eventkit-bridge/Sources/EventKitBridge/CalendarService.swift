import Foundation

struct CalendarDTO: Codable, Equatable {
  let id: String
  let title: String
  let writable: Bool

  init(_ calendar: EventCalendar) {
    id = calendar.id
    title = calendar.title
    writable = calendar.isWritable
  }
}

struct EventDTO: Codable, Equatable {
  let id: String
  let title: String
  let start: String
  let end: String
  let allDay: Bool
  let calendar: CalendarDTO
  let location: String?
  let notes: String?
  let url: String?
  let availability: String
  let recurring: Bool
}

struct CalendarListRequest {
  let start: Date
  let end: Date
  let calendarIDs: [String]?
}

struct CalendarCreateRequest {
  let title: String
  let start: Date
  let end: Date
  let allDay: Bool
  let calendarID: String?
  let location: String?
  let notes: String?
  let url: URL?
  let availability: String

  init(
    title: String,
    start: Date,
    end: Date,
    allDay: Bool = false,
    calendarID: String? = nil,
    location: String? = nil,
    notes: String? = nil,
    url: URL? = nil,
    availability: String = "busy"
  ) {
    self.title = title
    self.start = start
    self.end = end
    self.allDay = allDay
    self.calendarID = calendarID
    self.location = location
    self.notes = notes
    self.url = url
    self.availability = availability
  }
}

enum RecurrenceSpan: String, Codable, Equatable {
  case thisEvent
  case futureEvents
}

struct CalendarUpdateRequest {
  let title: String?
  let start: Date?
  let end: Date?
  let allDay: Bool?
  let calendarID: String?
  let location: String?
  let notes: String?
  let url: URL?
  let availability: String?
  let span: RecurrenceSpan?

  init(
    title: String? = nil,
    start: Date? = nil,
    end: Date? = nil,
    allDay: Bool? = nil,
    calendarID: String? = nil,
    location: String? = nil,
    notes: String? = nil,
    url: URL? = nil,
    availability: String? = nil,
    span: RecurrenceSpan? = nil
  ) {
    self.title = title
    self.start = start
    self.end = end
    self.allDay = allDay
    self.calendarID = calendarID
    self.location = location
    self.notes = notes
    self.url = url
    self.availability = availability
    self.span = span
  }
}

@MainActor final class CalendarService {
  private let store: any EventStoreClient

  init(store: any EventStoreClient) {
    self.store = store
  }

  func calendars() throws -> [CalendarDTO] {
    try store.calendars().map(CalendarDTO.init)
  }

  func list(_ request: CalendarListRequest) throws -> [EventDTO] {
    try validateDateRange(start: request.start, end: request.end)
    return try store.events(start: request.start, end: request.end, calendarIDs: request.calendarIDs)
      .sorted { $0.start < $1.start }
      .map(eventDTO)
  }

  func get(id: String) throws -> EventDTO {
    try eventDTO(event(withIdentifier: id))
  }

  func create(_ request: CalendarCreateRequest) throws -> EventDTO {
    try validateDateRange(start: request.start, end: request.end)
    let calendar = try writableCalendar(for: request.calendarID)
    let event = store.makeEvent()
    event.title = request.title
    event.start = request.start
    event.end = request.end
    event.isAllDay = request.allDay
    event.calendar = calendar
    event.location = request.location
    event.notes = request.notes
    event.url = request.url
    event.availability = request.availability
    try save(event, span: .thisEvent)
    return try eventDTO(event)
  }

  func update(id: String, request: CalendarUpdateRequest) throws -> EventDTO {
    let event = try event(withIdentifier: id)
    let start = request.start ?? event.start
    let end = request.end ?? event.end
    try validateDateRange(start: start, end: end)
    let calendar = try writableCalendar(for: request.calendarID, fallback: event.calendar)
    let span = try mutationSpan(for: event, requested: request.span)

    if let title = request.title { event.title = title }
    event.start = start
    event.end = end
    if let allDay = request.allDay { event.isAllDay = allDay }
    event.calendar = calendar
    if let location = request.location { event.location = location }
    if let notes = request.notes { event.notes = notes }
    if let url = request.url { event.url = url }
    if let availability = request.availability { event.availability = availability }
    try save(event, span: span)
    return try eventDTO(event)
  }

  func delete(id: String, span: RecurrenceSpan?) throws {
    let event = try event(withIdentifier: id)
    _ = try writableCalendar(for: nil, fallback: event.calendar)
    try remove(event, span: mutationSpan(for: event, requested: span))
  }

  private func event(withIdentifier id: String) throws -> any EventRecord {
    guard let event = store.event(withIdentifier: id) else {
      throw BridgeFailure(code: .eventNotFound, message: "Calendar event not found.")
    }
    return event
  }

  private func writableCalendar(
    for requestedID: String?,
    fallback: EventCalendar? = nil
  ) throws -> EventCalendar {
    let calendar: EventCalendar?
    if let requestedID {
      calendar = store.calendar(withIdentifier: requestedID)
    } else if let fallback {
      calendar = fallback
    } else {
      calendar = store.defaultCalendarForNewEvents()
    }

    guard let calendar else {
      throw BridgeFailure(code: .calendarNotFound, message: "Calendar not found.")
    }
    guard calendar.isWritable else {
      throw BridgeFailure(code: .readOnlyCalendar, message: "Calendar does not allow modifications.")
    }
    return calendar
  }

  private func mutationSpan(
    for event: any EventRecord,
    requested: RecurrenceSpan?
  ) throws -> EventStoreSpan {
    if event.hasRecurrenceRules, requested == nil {
      throw BridgeFailure(
        code: .recurringEventRequiresSpan,
        message: "Recurring events require thisEvent or futureEvents."
      )
    }
    return requested.map { EventStoreSpan(rawValue: $0.rawValue)! } ?? .thisEvent
  }

  private func validateDateRange(start: Date, end: Date) throws {
    guard end > start else {
      throw BridgeFailure(code: .invalidDateRange, message: "Event end must be after start.")
    }
  }

  private func save(_ event: any EventRecord, span: EventStoreSpan) throws {
    do {
      try store.save(event, span: span)
    } catch {
      throw BridgeFailure(code: .saveFailed, message: "Could not save calendar event.")
    }
  }

  private func remove(_ event: any EventRecord, span: EventStoreSpan) throws {
    do {
      try store.remove(event, span: span)
    } catch {
      throw BridgeFailure(code: .deleteFailed, message: "Could not delete calendar event.")
    }
  }

  private func eventDTO(_ event: any EventRecord) throws -> EventDTO {
    guard let id = event.id else {
      throw BridgeFailure(code: .saveFailed, message: "Calendar event did not receive an identifier.")
    }
    guard let calendar = event.calendar else {
      throw BridgeFailure(code: .calendarNotFound, message: "Calendar event has no calendar.")
    }
    return EventDTO(
      id: id,
      title: event.title,
      start: DateCodec.formatInstant(event.start),
      end: DateCodec.formatInstant(event.end),
      allDay: event.isAllDay,
      calendar: CalendarDTO(calendar),
      location: event.location,
      notes: event.notes,
      url: event.url?.absoluteString,
      availability: event.availability,
      recurring: event.hasRecurrenceRules
    )
  }
}
