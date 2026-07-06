import React from "react";

interface Props {
  name: string;
}

// Renders a greeting
export function Greeting({ name }: Props) {
  return <div>Hello, {name}!</div>;
}
