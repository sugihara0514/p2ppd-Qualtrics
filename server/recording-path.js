// Always use Japan time, regardless of the deployment host's timezone.
export function recordingDateJst(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = type => parts.find(part => part.type === type).value;
  return value('year') + value('month') + value('day');
}

export function recordingPrefix(channel, date = new Date()) {
  // Agora's prefix segments accept alphanumeric characters.
  const room = String(channel).replace(/[^a-zA-Z0-9]/g, '') || 'room';
  return [recordingDateJst(date), room];
}
