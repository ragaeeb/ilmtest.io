/**
 * Generate a URL-safe slug
 */
export const slugify = (...texts: string[]) => {
    return texts
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .replace(/[^\w-]+/g, '') // Remove non-word chars except hyphens
        .replace(/--+/g, '-') // Replace multiple hyphens with single hyphen
        .replace(/^-+/, '') // Trim hyphens from start
        .replace(/-+$/, ''); // Trim hyphens from end
};
