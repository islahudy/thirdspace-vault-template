import Foundation

enum JSONValue: Codable, Equatable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSONValue])
  case object([String: JSONValue])

  init(from decoder: any Decoder) throws {
    let container = try decoder.singleValueContainer()

    if container.decodeNil() {
      self = .null
    } else if let value = try? container.decode(Bool.self) {
      self = .bool(value)
    } else if let value = try? container.decode(Double.self) {
      self = .number(value)
    } else if let value = try? container.decode(String.self) {
      self = .string(value)
    } else if let value = try? container.decode([JSONValue].self) {
      self = .array(value)
    } else if let value = try? container.decode([String: JSONValue].self) {
      self = .object(value)
    } else {
      throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value")
    }
  }

  func encode(to encoder: any Encoder) throws {
    var container = encoder.singleValueContainer()

    switch self {
    case .null:
      try container.encodeNil()
    case .bool(let value):
      try container.encode(value)
    case .number(let value):
      try container.encode(value)
    case .string(let value):
      try container.encode(value)
    case .array(let value):
      try container.encode(value)
    case .object(let value):
      try container.encode(value)
    }
  }
}

struct BridgeRequest: Codable, Equatable {
  let action: String
  let params: JSONValue?
}

enum BridgeErrorCode: String, Codable, Equatable {
  case permissionDenied = "PERMISSION_DENIED"
  case eventNotFound = "EVENT_NOT_FOUND"
  case reminderNotFound = "REMINDER_NOT_FOUND"
  case calendarNotFound = "CALENDAR_NOT_FOUND"
  case reminderListNotFound = "REMINDER_LIST_NOT_FOUND"
  case invalidDate = "INVALID_DATE"
  case invalidDateRange = "INVALID_DATE_RANGE"
  case recurringEventRequiresSpan = "RECURRING_EVENT_REQUIRES_SPAN"
  case readOnlyCalendar = "READ_ONLY_CALENDAR"
  case saveFailed = "SAVE_FAILED"
  case deleteFailed = "DELETE_FAILED"
  case eventKitError = "EVENTKIT_ERROR"
  case invalidRequest = "INVALID_REQUEST"
  case bridgeNotFound = "BRIDGE_NOT_FOUND"
  case bridgeTimeout = "BRIDGE_TIMEOUT"
  case invalidBridgeResponse = "INVALID_BRIDGE_RESPONSE"
}

struct BridgeError: Codable, Equatable {
  let code: BridgeErrorCode
  let message: String
  let details: JSONValue?

  init(code: BridgeErrorCode, message: String, details: JSONValue? = nil) {
    self.code = code
    self.message = message
    self.details = details
  }
}

struct BridgeFailure: Error, Equatable {
  let error: BridgeError

  init(_ error: BridgeError) {
    self.error = error
  }

  init(code: BridgeErrorCode, message: String) {
    self.init(.init(code: code, message: message))
  }
}

enum BridgeResponse: Encodable {
  case success(any Encodable)
  case failure(BridgeError)

  private enum CodingKeys: String, CodingKey {
    case success
    case data
    case error
  }

  func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)

    switch self {
    case .success(let payload):
      try container.encode(true, forKey: .success)
      try container.encode(AnyEncodable(payload), forKey: .data)
    case .failure(let error):
      try container.encode(false, forKey: .success)
      try container.encode(error, forKey: .error)
    }
  }
}

private struct AnyEncodable: Encodable {
  private let encodeValue: (any Encoder) throws -> Void

  init(_ value: any Encodable) {
    encodeValue = value.encode(to:)
  }

  func encode(to encoder: any Encoder) throws {
    try encodeValue(encoder)
  }
}

enum BridgeBootstrap {
  static func dispatcherUnavailableResponse() -> BridgeResponse {
    .failure(.init(
      code: .invalidRequest,
      message: "EventKit bridge dispatcher is not installed."
    ))
  }

  static func run() {
    _ = FileHandle.standardInput.readDataToEndOfFile()

    let response = dispatcherUnavailableResponse()
    let fallback = Data(
      #"{"success":false,"error":{"code":"INVALID_REQUEST","message":"EventKit bridge dispatcher is not installed."}}"#.utf8
    )
    let output = (try? JSONEncoder().encode(response)) ?? fallback

    FileHandle.standardOutput.write(output)
    FileHandle.standardOutput.write(Data([0x0A]))
  }
}

// Task 5 replaces this bootstrap entry point with the dispatcher-backed main.swift.
@main
struct EventKitBridgeExecutable {
  static func main() {
    BridgeBootstrap.run()
  }
}
