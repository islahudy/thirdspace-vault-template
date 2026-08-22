import Foundation

enum DateCodec {
  private static let timezonePattern = #"(?:Z|[+-]\d{2}:\d{2})$"#
  private static let allDayPattern = #"^\d{4}-\d{2}-\d{2}$"#

  static func parseInstant(_ value: String) throws -> Date {
    guard value.range(of: timezonePattern, options: .regularExpression) != nil else {
      throw BridgeFailure(code: .invalidDate, message: "Timestamp must include an explicit timezone.")
    }

    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    if let date = formatter.date(from: value) {
      return date
    }

    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = formatter.date(from: value) else {
      throw BridgeFailure(code: .invalidDate, message: "Invalid ISO 8601 timestamp.")
    }
    return date
  }

  static func formatInstant(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.string(from: date)
  }

  static func parseAllDay(_ value: String) throws -> DateComponents {
    guard value.range(of: allDayPattern, options: .regularExpression) != nil else {
      throw BridgeFailure(code: .invalidDate, message: "All-day dates must use YYYY-MM-DD.")
    }

    let parts = value.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3 else {
      throw BridgeFailure(code: .invalidDate, message: "Invalid all-day date.")
    }

    let components = DateComponents(year: parts[0], month: parts[1], day: parts[2])
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    guard let date = calendar.date(from: components),
          calendar.dateComponents([.year, .month, .day], from: date) == components else {
      throw BridgeFailure(code: .invalidDate, message: "Invalid all-day date.")
    }
    return components
  }

  static func formatAllDay(_ components: DateComponents) -> String {
    guard let year = components.year, let month = components.month, let day = components.day else {
      return ""
    }
    return String(format: "%04d-%02d-%02d", year, month, day)
  }
}
