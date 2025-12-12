import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import isToday from 'dayjs/plugin/isToday';
import isTomorrow from 'dayjs/plugin/isTomorrow';
import isYesterday from 'dayjs/plugin/isYesterday';

// Extend dayjs with plugins
dayjs.extend(relativeTime);
dayjs.extend(isToday);
dayjs.extend(isTomorrow);
dayjs.extend(isYesterday);

// Storage format used in database
export const STORAGE_FORMAT = 'DD-MM-YYYY';

// Display formats
export const DISPLAY_FORMATS = {
  short: 'MMM D',           // Dec 12
  medium: 'MMM D, YYYY',    // Dec 12, 2025
  long: 'MMMM D, YYYY',     // December 12, 2025
  full: 'dddd, MMMM D, YYYY', // Thursday, December 12, 2025
  withTime: 'MMM D, YYYY [at] h:mm A', // Dec 12, 2025 at 3:30 PM
};

/**
 * Parse a date string - handles both DD-MM-YYYY and ISO formats
 */
export const parseDate = (dateString) => {
  if (!dateString) return dayjs();
  
  // Check if it's an ISO format (contains T or looks like YYYY-MM-DD)
  if (dateString.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(dateString)) {
    return dayjs(dateString);
  }
  
  // Otherwise parse as DD-MM-YYYY
  return dayjs(dateString, STORAGE_FORMAT);
};

/**
 * Format a date for display
 * @param {string} dateString - Date in storage format (DD-MM-YYYY) or ISO format
 * @param {string} format - One of: 'short', 'medium', 'long', 'full', 'relative', 'smart'
 */
export const formatDate = (dateString, format = 'medium') => {
  if (!dateString) return '';
  
  const date = parseDate(dateString);
  
  if (!date.isValid()) return dateString;

  switch (format) {
    case 'relative':
      return date.fromNow();
    
    case 'smart':
      // Smart formatting based on how close the date is
      if (date.isToday()) return 'Today';
      if (date.isTomorrow()) return 'Tomorrow';
      if (date.isYesterday()) return 'Yesterday';
      
      const now = dayjs();
      const diffDays = date.diff(now, 'day');
      
      // Within this week
      if (diffDays > 0 && diffDays <= 6) {
        return date.format('dddd'); // Monday, Tuesday, etc.
      }
      
      // Within this year
      if (date.year() === now.year()) {
        return date.format('MMM D'); // Dec 12
      }
      
      // Different year
      return date.format('MMM D, YYYY');
    
    case 'short':
      return date.format(DISPLAY_FORMATS.short);
    
    case 'long':
      return date.format(DISPLAY_FORMATS.long);
    
    case 'full':
      return date.format(DISPLAY_FORMATS.full);
    
    case 'medium':
    default:
      return date.format(DISPLAY_FORMATS.medium);
  }
};

/**
 * Format date for the DatePicker display
 */
export const formatForPicker = (date) => {
  if (!date) return '';
  return dayjs(date).format(STORAGE_FORMAT);
};

/**
 * Get relative time string (e.g., "2 days ago", "in 3 days")
 */
export const getRelativeTime = (dateString) => {
  if (!dateString) return '';
  const date = parseDate(dateString);
  return date.isValid() ? date.fromNow() : '';
};

/**
 * Check if a date is overdue
 */
export const isOverdue = (dateString) => {
  if (!dateString) return false;
  const date = parseDate(dateString);
  return date.isValid() && date.isBefore(dayjs(), 'day');
};

/**
 * Check if a date is today
 */
export const isDueToday = (dateString) => {
  if (!dateString) return false;
  const date = parseDate(dateString);
  return date.isValid() && date.isToday();
};

/**
 * Get a friendly due date label with color suggestion
 */
export const getDueDateInfo = (dateString, isCompleted = false) => {
  if (!dateString) return { label: '', color: 'default' };
  
  if (isCompleted) {
    return { 
      label: formatDate(dateString, 'smart'), 
      color: 'success' 
    };
  }

  const date = parseDate(dateString);
  if (!date.isValid()) return { label: dateString, color: 'default' };

  if (date.isToday()) {
    return { label: 'Due Today', color: 'warning' };
  }
  
  if (date.isTomorrow()) {
    return { label: 'Due Tomorrow', color: 'processing' };
  }
  
  if (isOverdue(dateString)) {
    const daysOverdue = dayjs().diff(date, 'day');
    return { 
      label: `${daysOverdue} day${daysOverdue > 1 ? 's' : ''} overdue`, 
      color: 'error' 
    };
  }

  const daysUntil = date.diff(dayjs(), 'day');
  if (daysUntil <= 7) {
    return { label: date.format('dddd'), color: 'processing' };
  }

  return { label: formatDate(dateString, 'smart'), color: 'default' };
};

export default {
  formatDate,
  parseDate,
  getRelativeTime,
  isOverdue,
  isDueToday,
  getDueDateInfo,
  STORAGE_FORMAT,
  DISPLAY_FORMATS,
};
