import { fakeRooms } from './rooms.mjs';
import { makeLocoMessageEvent } from './loco-events.mjs';

export class FakeKakaoClient {
  #rooms;
  #messages;

  constructor({ rooms = Object.values(fakeRooms), messages = [makeLocoMessageEvent()] } = {}) {
    this.#rooms = rooms.map((room) => Object.freeze({ ...room }));
    this.#messages = messages.map((message) => Object.freeze({ ...message }));
  }

  async listChats() {
    return this.#rooms;
  }

  async getMessages(chatroomId) {
    return this.#messages.filter((message) => message.chatroomId === chatroomId);
  }
}
