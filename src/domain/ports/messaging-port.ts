/** E.164 digits without the plus sign, e.g. "15550000000". */
export type PhoneNumber = string;

export interface MessagingPort {
  /** Send one outbound text message. Throws MessageSendError on failure. */
  sendMessage(to: PhoneNumber, text: string): Promise<void>;
}
