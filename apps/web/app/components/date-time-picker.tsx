import { add } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/utils/cn";
import type { ComponentProps } from "react";
import type { DayPicker } from "react-day-picker";
import TimePicker12h from "./time-picker/time-picker-12h";
import { formatDateTime } from "@/utils/date";

export function DateTimePicker({
  className,
  date,
  setDate,
  dayPicker,
}: {
  className?: string;
  date: Date;
  setDate: (date: Date) => void;
  dayPicker?: {
    disabled: ComponentProps<typeof DayPicker>["disabled"];
  };
}) {
  /**
   * carry over the current time when a user clicks a new day
   * instead of resetting to 00:00
   */
  const handleSelect = (newDay: Date | undefined) => {
    if (!newDay) return;
    if (!date) {
      setDate(newDay);
      return;
    }
    const diff = newDay.getTime() - date.getTime();
    const diffInDays = diff / (1000 * 60 * 60 * 24);
    const newDateFull = add(date, { days: Math.ceil(diffInDays) });
    setDate(newDateFull);
  };

  const formatDate = (date: Date) => {
    return formatDateTime(date);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={"outline"}
          className={cn(
            "justify-start text-left font-normal",
            !date && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? formatDate(date) : <span>Pick a date</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          selected={date}
          onSelect={(d) => handleSelect(d)}
          initialFocus
          {...dayPicker}
        />
        <div className="border-border border-t p-3">
          <TimePicker12h setDate={setDate} date={date} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
