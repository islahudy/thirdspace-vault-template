import Foundation
import Testing
@testable import EventKitBridge

@Test func rejectsTimestampWithoutTimezone() throws {
  #expect(throws: BridgeFailure.self) {
    try DateCodec.parseInstant("2026-08-22T10:00:00")
  }
}

@Test func rejectsInvalidTimestamp() throws {
  #expect(throws: BridgeFailure.self) {
    try DateCodec.parseInstant("not-a-date+08:00")
  }
}

@Test func formatsInstantAsUTCISO8601() throws {
  let instant = try DateCodec.parseInstant("2026-08-22T10:00:00+08:00")

  #expect(DateCodec.formatInstant(instant) == "2026-08-22T02:00:00Z")
}

@Test func roundTripsAllDayDateComponents() throws {
  let components = try DateCodec.parseAllDay("2026-08-22")

  #expect(components.year == 2026)
  #expect(components.month == 8)
  #expect(components.day == 22)
  #expect(DateCodec.formatAllDay(components) == "2026-08-22")
}
