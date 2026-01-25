const ARABIC_TO_WESTERN: Record<string, string> = {
    '٠': '0',
    '١': '1',
    '٢': '2',
    '٣': '3',
    '٤': '4',
    '٥': '5',
    '٦': '6',
    '٧': '7',
    '٨': '8',
    '٩': '9',
} as const;

export const arabicToWestern = (arabicNum: string) => {
    const western = arabicNum.replace(/[٠-٩]/g, (digit) => ARABIC_TO_WESTERN[digit]);
    return Number.parseInt(western, 10);
};
