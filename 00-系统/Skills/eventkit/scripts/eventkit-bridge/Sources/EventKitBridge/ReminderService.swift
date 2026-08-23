import Foundation

struct ReminderDTO: Codable, Equatable {
  let id: String
  let title: String
  let list: CalendarDTO
  let completed: Bool
  let completionDate: String?
  let startDate: String?
  let dueDate: String?
  let priority: Int
  let notes: String?
}

struct ReminderListRequest {
  let status: ReminderStatus
  let listIDs: [String]?

  init(status: ReminderStatus = .all, listIDs: [String]? = nil) {
    self.status = status
    self.listIDs = listIDs
  }
}

struct ReminderCreateRequest {
  let title: String
  let listID: String?
  let startDate: Date?
  let dueDate: Date?
  let priority: Int
  let notes: String?

  init(
    title: String,
    listID: String? = nil,
    startDate: Date? = nil,
    dueDate: Date? = nil,
    priority: Int = 0,
    notes: String? = nil
  ) {
    self.title = title
    self.listID = listID
    self.startDate = startDate
    self.dueDate = dueDate
    self.priority = priority
    self.notes = notes
  }
}

struct ReminderUpdateRequest {
  let title: String?
  let listID: String?
  let startDate: Date?
  let dueDate: Date?
  let priority: Int?
  let notes: String?

  init(
    title: String? = nil,
    listID: String? = nil,
    startDate: Date? = nil,
    dueDate: Date? = nil,
    priority: Int? = nil,
    notes: String? = nil
  ) {
    self.title = title
    self.listID = listID
    self.startDate = startDate
    self.dueDate = dueDate
    self.priority = priority
    self.notes = notes
  }
}

@MainActor final class ReminderService {
  private let store: any EventStoreClient

  init(store: any EventStoreClient) {
    self.store = store
  }

  func list(_ request: ReminderListRequest = .init()) async throws -> [ReminderDTO] {
    try await store.reminders(
      matching: .init(status: request.status, listIDs: request.listIDs)
    ).map(reminderDTO)
  }

  func get(id: String) async throws -> ReminderDTO {
    try reminderDTO(reminder(withIdentifier: id))
  }

  func create(_ request: ReminderCreateRequest) async throws -> ReminderDTO {
    let list = try writableList(for: request.listID)
    guard let reminder = store.makeReminder() else {
      throw BridgeFailure(code: .saveFailed, message: "Could not create reminder.")
    }
    reminder.title = request.title
    reminder.list = list
    reminder.startDate = request.startDate
    reminder.dueDate = request.dueDate
    reminder.priority = request.priority
    reminder.notes = request.notes
    try save(reminder)
    return try reminderDTO(reminder)
  }

  func update(id: String, request: ReminderUpdateRequest) async throws -> ReminderDTO {
    let reminder = try reminder(withIdentifier: id)
    let list = try writableList(for: request.listID, fallback: reminder.list)

    if let title = request.title { reminder.title = title }
    reminder.list = list
    if let startDate = request.startDate { reminder.startDate = startDate }
    if let dueDate = request.dueDate { reminder.dueDate = dueDate }
    if let priority = request.priority { reminder.priority = priority }
    if let notes = request.notes { reminder.notes = notes }
    try save(reminder)
    return try reminderDTO(reminder)
  }

  func delete(id: String) async throws {
    let reminder = try reminder(withIdentifier: id)
    _ = try writableList(for: nil, fallback: reminder.list)
    do {
      try store.remove(reminder)
    } catch {
      throw BridgeFailure(code: .deleteFailed, message: "Could not delete reminder.")
    }
  }

  func setCompleted(id: String, completed: Bool) async throws -> ReminderDTO {
    let reminder = try reminder(withIdentifier: id)
    _ = try writableList(for: nil, fallback: reminder.list)
    reminder.isCompleted = completed
    try save(reminder)
    return try reminderDTO(reminder)
  }

  private func reminder(withIdentifier id: String) throws -> any ReminderRecord {
    guard let reminder = store.reminder(withIdentifier: id) else {
      throw BridgeFailure(code: .reminderNotFound, message: "Reminder not found.")
    }
    return reminder
  }

  private func writableList(
    for requestedID: String?,
    fallback: EventCalendar? = nil
  ) throws -> EventCalendar {
    let list: EventCalendar?
    if let requestedID {
      list = store.reminderList(withIdentifier: requestedID)
    } else if let fallback {
      list = fallback
    } else {
      list = store.defaultReminderList()
    }

    guard let list else {
      throw BridgeFailure(code: .reminderListNotFound, message: "Reminder list not found.")
    }
    guard list.isWritable else {
      throw BridgeFailure(code: .readOnlyCalendar, message: "Reminder list does not allow modifications.")
    }
    return list
  }

  private func save(_ reminder: any ReminderRecord) throws {
    do {
      try store.save(reminder)
    } catch {
      throw BridgeFailure(code: .saveFailed, message: "Could not save reminder.")
    }
  }

  private func reminderDTO(_ reminder: any ReminderRecord) throws -> ReminderDTO {
    guard let id = reminder.id else {
      throw BridgeFailure(code: .saveFailed, message: "Reminder did not receive an identifier.")
    }
    guard let list = reminder.list else {
      throw BridgeFailure(code: .reminderListNotFound, message: "Reminder has no list.")
    }
    return ReminderDTO(
      id: id,
      title: reminder.title,
      list: CalendarDTO(list),
      completed: reminder.isCompleted,
      completionDate: reminder.completionDate.map(DateCodec.formatInstant),
      startDate: reminder.startDate.map(DateCodec.formatInstant),
      dueDate: reminder.dueDate.map(DateCodec.formatInstant),
      priority: reminder.priority,
      notes: reminder.notes
    )
  }
}
