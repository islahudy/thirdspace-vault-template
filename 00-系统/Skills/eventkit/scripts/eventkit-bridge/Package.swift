// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "eventkit-bridge",
  platforms: [.macOS(.v14)],
  products: [.executable(name: "eventkit-bridge", targets: ["EventKitBridge"])],
  targets: [
    .executableTarget(
      name: "EventKitBridge",
      linkerSettings: [.unsafeFlags([
        "-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist",
        "-Xlinker", "Info.plist",
      ])]
    ),
    .testTarget(name: "EventKitBridgeTests", dependencies: ["EventKitBridge"]),
  ]
)
