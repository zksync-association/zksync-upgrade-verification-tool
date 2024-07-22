import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAsyncValue } from "@remix-run/react";
import ReactMarkdown from "react-markdown";

export default function TallyInfo() {
    const {data:{proposal:{metadata}} } = useAsyncValue();

    const { title, description } = metadata;
    return (
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <ReactMarkdown
            className="prose max-w-none"
            components={{
              h1: HeadingRenderer,
              h2: HeadingRenderer,
              h3: HeadingRenderer,
              h4: HeadingRenderer,
              h5: HeadingRenderer,
              h6: HeadingRenderer,
            }}
          >
            {description}
          </ReactMarkdown>
        </CardContent>
      </Card>
    );
  }

const HeadingRenderer = ({
  children,
  ...props
}: { children: React.ReactNode; [key: string]: any }) => {
  const baseClasses = "font-semibold my-2";

  switch (props.node?.tagName) {
    case "h1":
      return <h1 className={`${baseClasses} text-3xl my-4`}>{children}</h1>;
    case "h2":
      return <h2 className={`${baseClasses} text-2xl my-3`}>{children}</h2>;
    case "h3":
      return <h3 className={`${baseClasses} text-xl`}>{children}</h3>;
    case "h4":
      return <h4 className={`${baseClasses} text-lg`}>{children}</h4>;
    case "h5":
      return <h5 className={`${baseClasses} text-base`}>{children}</h5>;
    case "h6":
      return <h6 className={`${baseClasses} text-sm`}>{children}</h6>;
    default:
      return <p className="text-base my-2">{children}</p>;
  }
};
