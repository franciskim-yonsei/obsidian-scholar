function pad(value: number): string {
	return String(value).padStart(2, '0');
}

export function toDateString(date: Date): string {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toPubMedDate(date: Date): string {
	return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

export function addDays(date: Date, days: number): Date {
	const next = new Date(date.getTime());
	next.setDate(next.getDate() + days);
	return next;
}

