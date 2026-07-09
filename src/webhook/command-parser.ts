export type Command = 
{ command: 'status' } | { command: 'summary' } | { command: 'unknown' }


export function parseCommand(text: string): Command {
    const normalizedText = text.trim().toLowerCase();
    if (normalizedText === 'status') {
        return { command: 'status' }
    } else if (normalizedText === 'summary') {
        return { command: 'summary' }
    } else {
        return { command: 'unknown' }
    }
}