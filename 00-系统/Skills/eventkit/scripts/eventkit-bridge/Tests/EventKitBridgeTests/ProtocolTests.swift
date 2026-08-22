import Foundation
import Testing
@testable import EventKitBridge

@Test func decodesRequestWithJSONParams() throws {
  let request = try JSONDecoder().decode(
    BridgeRequest.self,
    from: Data(#"{"action":"calendar.list","params":{"limit":3,"includeArchived":false}}"#.utf8)
  )

  #expect(request.action == "calendar.list")
  #expect(request.params == .object([
    "limit": .number(3),
    "includeArchived": .bool(false),
  ]))
}

@Test func successResponseUsesStableShape() throws {
  let response = BridgeResponse.success(["id": "ABC123"])
  let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(response)) as! [String: Any]

  #expect(object["success"] as? Bool == true)
  #expect((object["data"] as? [String: Any])?["id"] as? String == "ABC123")
}

@Test func errorResponseUsesStableShape() throws {
  let response = BridgeResponse.failure(.init(code: .invalidDate, message: "bad date"))
  let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(response)) as! [String: Any]

  #expect(object["success"] as? Bool == false)
  #expect((object["error"] as? [String: Any])?["code"] as? String == "INVALID_DATE")
  #expect((object["error"] as? [String: Any])?["message"] as? String == "bad date")
}

@Test func placeholderEntrypointUsesStructuredFailure() throws {
  let response = BridgeBootstrap.dispatcherUnavailableResponse()
  let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(response)) as! [String: Any]

  #expect(object["success"] as? Bool == false)
  #expect((object["error"] as? [String: Any])?["code"] as? String == "INVALID_REQUEST")
}
