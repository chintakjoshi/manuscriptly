type LoadingSkeletonProps = {
  className?: string;
};

export function LoadingSkeleton({ className = "" }: LoadingSkeletonProps) {
  return (
    <div className={`flex items-center ${className}`}>
      <span
        role="status"
        aria-label="Loading"
        className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-slate-200"
      />
    </div>
  );
}
