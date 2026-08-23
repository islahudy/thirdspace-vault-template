import Foundation

@MainActor final class BridgeDispatcher {
  private let store: any EventStoreClient
  private let permissions: any PermissionServicing
  private let calendarService: CalendarService
  private let reminderService: ReminderService

  init(store: any EventStoreClient, permissions: any PermissionServicing) {
    self.store = store
    self.permissions = permissions
    calendarService = CalendarService(store: store)
    reminderService = ReminderService(store: store)
  }

  func dispatch(_ request: BridgeRequest) async -> BridgeResponse {
    do {
      switch request.action {
      case "auth.status":
        return .success(permissions.status())
      case "auth.request":
        return .success(try await permissions.request())
      case "calendar.calendars":
        try requireFullAccess(permissions.status().calendar, resource: "calendar")
        return .success(try calendarService.calendars())
      case "calendar.list":
        try requireFullAccess(permissions.status().calendar, resource: "calendar")
        return .success(try calendarService.list(try calendarListRequest(request.params)))
      case "calendar.get":
        try requireFullAccess(permissions.status().calendar, resource: "calendar")
        return .success(try calendarService.get(id: try params(request.params).requiredString("id")))
      case "calendar.create":
        try requireFullAccess(permissions.status().calendar, resource: "calendar")
        return .success(try calendarService.create(try calendarCreateRequest(request.params)))
      case "calendar.update":
        try requireFullAccess(permissions.status().calendar, resource: "calendar")
        let values = try params(request.params)
        return .success(try calendarService.update(
          id: try values.requiredString("id"),
          request: try calendarUpdateRequest(values)
        ))
      case "calendar.delete":
        try requireFullAccess(permissions.status().calendar, resource: "calendar")
        let values = try params(request.params)
        let span = try values.optionalEnum("span", as: RecurrenceSpan.self)
        try calendarService.delete(id: try values.requiredString("id"), span: span)
        return .success(["deleted": true])
      case "reminder.lists":
        try requireFullAccess(permissions.status().reminders, resource: "reminders")
        return .success(store.reminderLists().map(CalendarDTO.init))
      case "reminder.list":
        try requireFullAccess(permissions.status().reminders, resource: "reminders")
        return .success(try await reminderService.list(try reminderListRequest(request.params)))
      case "reminder.get":
        try requireFullAccess(permissions.status().reminders, resource: "reminders")
        return .success(try await reminderService.get(id: try params(request.params).requiredString("id")))
      case "reminder.create":
        try requireFullAccess(permissions.status().reminders, resource: "reminders")
        return .success(try await reminderService.create(try reminderCreateRequest(request.params)))
      case "reminder.update":
        try requireFullAccess(permissions.status().reminders, resource: "reminders")
        let values = try params(request.params)
        return .success(try await reminderService.update(
          id: try values.requiredString("id"),
          request: try reminderUpdateRequest(values)
        ))
      case "reminder.delete":
        try requireFullAccess(permissions.status().reminders, resource: "reminders")
        try await reminderService.delete(id: try params(request.params).requiredString("id"))
        return .success(["deleted": true])
      case "reminder.complete":
        try requireFullAccess(permissions.status().reminders, resource: "reminders")
        return .success(try await reminderService.setCompleted(
          id: try params(request.params).requiredString("id"),
          completed: true
        ))
      case "reminder.reopen":
        try requireFullAccess(permissions.status().reminders, resource: "reminders")
        return .success(try await reminderService.setCompleted(
          id: try params(request.params).requiredString("id"),
          completed: false
        ))
      default:
        throw BridgeFailure(code: .invalidRequest, message: "Unknown action: \(request.action)")
      }
    } catch let failure as BridgeFailure {
      return .failure(failure.error)
    } catch {
      return .failure(.init(code: .eventKitError, message: "EventKit request failed."))
    }
  }

  private func requireFullAccess(_ state: AuthorizationState, resource: String) throws {
    guard state == .fullAccess else {
      throw BridgeFailure(
        code: .permissionDenied,
        message: "Full access to \(resource) is required. Run auth.request explicitly."
      )
    }
  }

  private func calendarListRequest(_ value: JSONValue?) throws -> CalendarListRequest {
    let values = try params(value)
    return try .init(
      start: DateCodec.parseInstant(values.requiredString("start")),
      end: DateCodec.parseInstant(values.requiredString("end")),
      calendarIDs: values.optionalStrings("calendarIDs")
    )
  }

  private func calendarCreateRequest(_ value: JSONValue?) throws -> CalendarCreateRequest {
    let values = try params(value)
    return try .init(
      title: values.requiredString("title"),
      start: DateCodec.parseInstant(values.requiredString("start")),
      end: DateCodec.parseInstant(values.requiredString("end")),
      allDay: values.optionalBool("allDay") ?? false,
      calendarID: values.optionalString("calendarID"),
      location: values.optionalString("location"),
      notes: values.optionalString("notes"),
      url: values.optionalURL("url"),
      availability: values.optionalString("availability") ?? "busy"
    )
  }

  private func calendarUpdateRequest(_ values: RequestParameters) throws -> CalendarUpdateRequest {
    try .init(
      title: values.optionalString("title"),
      start: values.optionalDate("start"),
      end: values.optionalDate("end"),
      allDay: values.optionalBool("allDay"),
      calendarID: values.optionalString("calendarID"),
      location: values.optionalString("location"),
      notes: values.optionalString("notes"),
      url: values.optionalURL("url"),
      availability: values.optionalString("availability"),
      span: values.optionalEnum("span", as: RecurrenceSpan.self)
    )
  }

  private func reminderListRequest(_ value: JSONValue?) throws -> ReminderListRequest {
    let values = try params(value)
    return try .init(
      status: values.optionalEnum("status", as: ReminderStatus.self) ?? .all,
      listIDs: values.optionalStrings("listIDs")
    )
  }

  private func reminderCreateRequest(_ value: JSONValue?) throws -> ReminderCreateRequest {
    let values = try params(value)
    return try .init(
      title: values.requiredString("title"),
      listID: values.optionalString("listID"),
      startDate: values.optionalDate("startDate"),
      dueDate: values.optionalDate("dueDate"),
      priority: values.optionalInt("priority") ?? 0,
      notes: values.optionalString("notes")
    )
  }

  private func reminderUpdateRequest(_ values: RequestParameters) throws -> ReminderUpdateRequest {
    try .init(
      title: values.optionalString("title"),
      listID: values.optionalString("listID"),
      startDate: values.optionalDate("startDate"),
      dueDate: values.optionalDate("dueDate"),
      priority: values.optionalInt("priority"),
      notes: values.optionalString("notes")
    )
  }

  private func params(_ value: JSONValue?) throws -> RequestParameters {
    switch value {
    case nil, .null:
      return .init(values: [:])
    case .object(let values):
      return .init(values: values)
    default:
      throw BridgeFailure(code: .invalidRequest, message: "params must be a JSON object.")
    }
  }
}

private struct RequestParameters {
  let values: [String: JSONValue]

  func requiredString(_ key: String) throws -> String {
    guard case .string(let value)? = values[key], !value.isEmpty else {
      throw invalid(key, expected: "a non-empty string")
    }
    return value
  }

  func optionalString(_ key: String) throws -> String? {
    guard let raw = values[key], raw != .null else { return nil }
    guard case .string(let value) = raw else { throw invalid(key, expected: "a string") }
    return value
  }

  func optionalBool(_ key: String) throws -> Bool? {
    guard let raw = values[key], raw != .null else { return nil }
    guard case .bool(let value) = raw else { throw invalid(key, expected: "a boolean") }
    return value
  }

  func optionalInt(_ key: String) throws -> Int? {
    guard let raw = values[key], raw != .null else { return nil }
    guard case .number(let value) = raw,
          value.isFinite,
          value.rounded(.towardZero) == value,
          let integer = Int(exactly: value) else {
      throw invalid(key, expected: "an integer")
    }
    return integer
  }

  func optionalStrings(_ key: String) throws -> [String]? {
    guard let raw = values[key], raw != .null else { return nil }
    guard case .array(let entries) = raw else { throw invalid(key, expected: "an array of strings") }
    return try entries.map { entry in
      guard case .string(let value) = entry else { throw invalid(key, expected: "an array of strings") }
      return value
    }
  }

  func optionalDate(_ key: String) throws -> Date? {
    try optionalString(key).map(DateCodec.parseInstant)
  }

  func optionalURL(_ key: String) throws -> URL? {
    guard let value = try optionalString(key) else { return nil }
    guard let url = URL(string: value), url.scheme != nil else {
      throw invalid(key, expected: "an absolute URL")
    }
    return url
  }

  func optionalEnum<T: RawRepresentable>(_ key: String, as type: T.Type) throws -> T?
  where T.RawValue == String {
    guard let value = try optionalString(key) else { return nil }
    guard let result = T(rawValue: value) else {
      throw invalid(key, expected: "a supported value")
    }
    return result
  }

  private func invalid(_ key: String, expected: String) -> BridgeFailure {
    BridgeFailure(code: .invalidRequest, message: "params.\(key) must be \(expected).")
  }
}
