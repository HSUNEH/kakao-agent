export class FakeMacOSBridge {
  sent = [];

  async sendMessage(chatroomId, text, { dryRun = true } = {}) {
    const event = Object.freeze({ chatroomId, text, dryRun });
    this.sent.push(event);
    return event;
  }
}
