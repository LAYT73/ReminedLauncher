import { Toast } from "@/shared/ui/Toast";
import { useToastStore } from "@/shared/lib/toast";

export function ToastHost() {
  const { message, tone, dismiss } = useToastStore();
  return <Toast message={message} tone={tone} onDone={dismiss} />;
}
