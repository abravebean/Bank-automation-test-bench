# Requirements R17 (amount validation) and R18 (business rules), against the built-in
# Ledgerline demo bank. Boundary values come straight from the rules:
# smallest amount $0.01, the available balance, and the $2,500.00 daily limit.
@R17 @R18
Feature: Transferring money between my accounts
  As a Ledgerline customer
  I want to move money between my checking and savings accounts
  So that my money is where I need it, within the bank's rules

  Background:
    Given I am signed in with "$1,000.00" in checking and "$5,000.00" in savings

  Scenario: A valid transfer updates my balance
    When I transfer "250.00" from checking to savings
    Then the transfer succeeds
    And my checking balance is "$750.00"
    And my savings balance is "$5,250.00"

  Scenario Outline: Amount <amount> (<why>)
    When I transfer "<amount>" from checking to savings
    Then I see "<result>"
    And my checking balance is "<checking>"

    Examples: Accepted
      | amount  | why                       | result            | checking |
      | 0.01    | smallest allowed amount   | Transfer complete | $999.99  |
      | 1000.00 | exactly the balance       | Transfer complete | $0.00    |

    Examples: Rejected
      | amount  | why                       | result                         | checking  |
      | 0       | zero                      | Amount must be more than $0.00 | $1,000.00 |
      | 1000.01 | one cent over the balance | Insufficient funds             | $1,000.00 |
      | 12.345  | three decimal places      | up to two decimal places       | $1,000.00 |
      | -20     | negative                  | up to two decimal places       | $1,000.00 |

  Scenario: The daily limit allows $2,500.00 and nothing more
    When I transfer "2500.00" from savings to checking
    Then the transfer succeeds
    When I transfer "0.01" from savings to checking
    Then I see "You can transfer $0.00 more today"
    And my savings balance is "$2,500.00"
