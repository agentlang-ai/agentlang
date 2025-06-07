import { EntitySchema, Table, TableColumnOptions } from "typeorm"
import { defaultDataSource } from "./resolvers/sqldb/database.js"

type User = {
    id?: number,
    firstName: string,
    lastName: string,
    isActive?: boolean
}

function makeUserClass() {
    /*@Entity()
    class User {
        @PrimaryGeneratedColumn()
        id: number = 0

        @Column()
        firstName: string = ''

        @Column()
        lastName: string = ''

        @Column()
        isActive: boolean = true
    }
    return User*/
    return new EntitySchema<User>({
        name: "user",
        columns: {
            id: {
                type: Number,
                primary: true,
                generated: true,
            },
            firstName: {
                type: String,
            },
            lastName: {
                type: String,
            },
            isActive: {
                type: Boolean,
                default: true
            }
        }
    })
}

export async function CreateTestEntities() {
    if (defaultDataSource) {
        const UserSchema = makeUserClass()
        /*const cols: TableColumnOptions[] = new Array()
        cols.push({name: "id", isPrimary: true, type: "int", isGenerated: true})
        cols.push({name: "firstName", type: "varchar"})
        cols.push({name: "lastName", type: "varchar"})
        cols.push({name: "isActive", type: "boolean", default: true})
        const table: Table = new Table({name: 'user', columns: cols})*/
        defaultDataSource.createQueryRunner().createTable(table)
        const userRepository = defaultDataSource.getRepository(UserSchema)
        const user = { firstName: "Timber", lastName: "Saw" }
        await userRepository.save(user)

        const allUsers = await userRepository.find()
        console.log(allUsers)
        const firstUser = await userRepository.findOneBy({
            id: 1,
        })
        console.log(firstUser)
        const timber = await userRepository.findOneBy({
            firstName: "Timber",
            lastName: "Saw"
        })
        console.log(timber)
    }
}