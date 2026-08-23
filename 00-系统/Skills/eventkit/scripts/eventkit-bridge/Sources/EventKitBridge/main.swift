import Darwin
import EventKit
import Foundation

@MainActor private func runBridge() async {
  let eventStore = EKEventStore()
  let dispatcher = BridgeDispatcher(
    store: LiveEventStoreClient(store: eventStore),
    permissions: PermissionService(eventStore: eventStore)
  )
  let input = FileHandle.standardInput.readDataToEndOfFile()
  let response: BridgeResponse

  do {
    let request = try JSONDecoder().decode(BridgeRequest.self, from: input)
    response = await dispatcher.dispatch(request)
  } catch {
    response = .failure(.init(
      code: .invalidRequest,
      message: "stdin must contain exactly one valid BridgeRequest JSON object."
    ))
  }

  guard write(response) else {
    exit(2)
  }
}

private func write(_ response: BridgeResponse) -> Bool {
  let encoder = JSONEncoder()
  let output: Data

  do {
    output = try encoder.encode(response)
  } catch {
    diagnose("Could not encode bridge response: \(error)")
    let fallback = BridgeResponse.failure(.init(
      code: .eventKitError,
      message: "Bridge response could not be encoded."
    ))
    guard let fallbackData = try? encoder.encode(fallback) else {
      diagnose("Could not encode fallback bridge response.")
      return false
    }
    output = fallbackData
  }

  FileHandle.standardOutput.write(output)
  FileHandle.standardOutput.write(Data([0x0A]))
  return true
}

private func diagnose(_ message: String) {
  FileHandle.standardError.write(Data((message + "\n").utf8))
}

await runBridge()
