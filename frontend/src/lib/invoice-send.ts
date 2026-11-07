/** The toast after sending an invoice: who it was emailed to, if anyone. */
export function sentMessage(number: string, emailedTo: string[]): string {
  if (!emailedTo.length) return `${number} marked as sent`;
  if (emailedTo.length === 1) return `${number} sent to ${emailedTo[0]}`;
  return `${number} sent to ${emailedTo[0]} and ${emailedTo.length - 1} more`;
}
