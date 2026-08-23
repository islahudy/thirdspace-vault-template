import EventKit

enum AuthorizationState: String, Codable, Equatable {
  case notDetermined
  case restricted
  case denied
  case writeOnly
  case fullAccess
}

struct AuthorizationSnapshot: Codable, Equatable {
  let calendar: AuthorizationState
  let reminders: AuthorizationState
}

@MainActor protocol PermissionServicing: AnyObject {
  func status() -> AuthorizationSnapshot
  func request() async throws -> AuthorizationSnapshot
}

@MainActor protocol AuthorizationStoreClient: AnyObject {
  func authorizationStatus(for entityType: EKEntityType) -> EKAuthorizationStatus
  func requestFullAccessToEvents() async throws -> Bool
  func requestFullAccessToReminders() async throws -> Bool
}

@MainActor final class PermissionService: PermissionServicing {
  private let client: any AuthorizationStoreClient

  init(client: any AuthorizationStoreClient) {
    self.client = client
  }

  convenience init(eventStore: EKEventStore) {
    self.init(client: LiveAuthorizationStoreClient(store: eventStore))
  }

  func status() -> AuthorizationSnapshot {
    .init(
      calendar: Self.map(client.authorizationStatus(for: .event)),
      reminders: Self.map(client.authorizationStatus(for: .reminder))
    )
  }

  func request() async throws -> AuthorizationSnapshot {
    guard #available(macOS 14.0, *) else {
      throw PermissionServiceError.fullAccessRequiresMacOS14
    }

    _ = try await client.requestFullAccessToEvents()
    _ = try await client.requestFullAccessToReminders()
    return status()
  }

  private static func map(_ status: EKAuthorizationStatus) -> AuthorizationState {
    switch status {
    case .notDetermined: .notDetermined
    case .restricted: .restricted
    case .denied: .denied
    case .writeOnly: .writeOnly
    case .fullAccess, .authorized: .fullAccess
    @unknown default: .denied
    }
  }
}

@MainActor private final class LiveAuthorizationStoreClient: AuthorizationStoreClient {
  private let store: EKEventStore

  init(store: EKEventStore) {
    self.store = store
  }

  func authorizationStatus(for entityType: EKEntityType) -> EKAuthorizationStatus {
    EKEventStore.authorizationStatus(for: entityType)
  }

  func requestFullAccessToEvents() async throws -> Bool {
    try await store.requestFullAccessToEvents()
  }

  func requestFullAccessToReminders() async throws -> Bool {
    try await store.requestFullAccessToReminders()
  }
}

private enum PermissionServiceError: Error {
  case fullAccessRequiresMacOS14
}
