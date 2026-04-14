function toLocalMidnight(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

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

export function getDaysBetween(fromDateExclusive: Date, toDateInclusive: Date): string[] {
	const dates: string[] = [];
	let cursor = addDays(toLocalMidnight(fromDateExclusive), 1);
	const end = toLocalMidnight(toDateInclusive);

	while (cursor.getTime() <= end.getTime()) {
		dates.push(toDateString(cursor));
		cursor = addDays(cursor, 1);
	}

	return dates;
}

export function getYesterdayDateString(referenceDate: Date = new Date()): string {
	return toDateString(addDays(toLocalMidnight(referenceDate), -1));
}

export function isSameLocalDay(a: Date, b: Date): boolean {
	return toDateString(a) === toDateString(b);
}

export function getClampedCatchupStart(lastRun: Date, now: Date, catchupLimitDays: number): Date {
	const earliest = addDays(toLocalMidnight(now), -Math.max(catchupLimitDays, 1));
	const lastRunDay = toLocalMidnight(lastRun);
	return lastRunDay.getTime() < earliest.getTime() ? earliest : lastRunDay;
}
