import inquirer from "inquirer";

export const greetCommand = async (person?: string) => {
  let target: string;
  if (person) {
    target = person;
  } else {
    const response = await inquirer.prompt<UsernameResponse>([
      {
        type: "input",
        name: "username",
        message: "What's your name?",
      },
    ]);
    target = response.username;
  }

  greeter(target);
};

const greeter = (name: string) => {
  console.log(`👋 Welcome ${name}! `);
};

interface UsernameResponse {
  username: string;
}
