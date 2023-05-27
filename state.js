







const char_code_of_0 = '0'.charCodeAt(0)
const char_code_of_9 = '9'.charCodeAt(0)
const char_code_of_comma = ','.charCodeAt(0)
const char_code_of_dot = '.'.charCodeAt(0)


class cell_type{

	static types = {
		string: {
			name:'string',
			convert: function(str) { return str },
			is_number: false,
		},
		float: {
			name:'float',
			convert: parseFloat,
			is_number: true,
		},
		int: {
			name:'int',
			convert: parseInt,
			is_number: true,
		},
		void: {
			name:'void',
			convert: function(str) {
				return null
			},
			is_number: false,
		}
	}
	
	static get_cell_type(cell) {

		if(cell == 'NaN') return cell_type.types.float
		if(cell == '') return cell_type.types.void

		let nb_dot_or_comma = 0
		let nb_numbers = 0

		for(let j = 0; j < cell.length; ++j) {
			const code = cell.charCodeAt(j)
			if(code >= char_code_of_0 && code <= char_code_of_9) ++nb_numbers
			else if(code == char_code_of_dot || code == char_code_of_comma){
				if(++nb_dot_or_comma > 1) return cell_type.types.string
			} 
			else return cell_type.types.string
		}
		
		if(nb_numbers == 0) return cell_type.types.string
		return cell_type.types[nb_dot_or_comma ? 'float' : 'int']
	}

	constructor(cell) {
		this.type = cell_type.get_cell_type(cell)
	}

	accumulate(cell) {
		if(this.type === cell_type.types.string) return;
		const type2 = cell_type.get_cell_type(cell)
		if(type2 === cell_type.types.string) {
			this.type = type2
		}
		else if(type2 === cell_type.types.float && (this.type === cell_type.types.int || this.type === cell_type.types.void)) {
			this.type = type2
		}
		else if(type2 === cell_type.types.int && this.type === cell_type.types.void) {
			this.type = type2
		}
	}

	get accumulation_wont_modify_me_anymore() {
		return this.type === cell_type.types.string
	}

	get convert() {
		return this.type.convert
	}

	is(type) { return this.type === type }

	get name() { return this.type.name }

	is_number() {return this.type.is_number}
}



const persist = {

	elms:[],

	scroll_x: 0,
	
	scroll_y: 0,

	privacy_budget: 1,

	aj_csv: function({name, txt}) {

		let e = null

		try{

			console.log('add_csv',{name})

			
			let src = null

			this.elms.push(e = {
				type: 'csv',
				tumult_source_id: name,
				get name(){return this.tumult_source_id},
				txt: txt,
				private: true,
				header: [],
				types:[],
				src: src={
					txt: txt,
					table: null,
					path: name,
					_delimiter: ';',
					get delimiter() {return this._delimiter},
					set delimiter(val) {
						this._delimiter = val
						this._parent.sample.remove_lines_with_null_or_NaN_cells.columns = []
						this._parent.sample.trim.min.columns = []
						this._parent.sample.trim.max.columns = []
						this._parent.sample.interquartile_range.columns = []
						this._parent.sample.standard_deviation.columns = []
						
						this._parent.generate_table_from_txt()
						for(const req of this._parent.requests) {
							req.columns = []
							req.maj_columns()
							req.maj_group_by()
						}
					},
					//spark_dataframe_successfully_loaded": true
					
				},
				
				responses: [],
				sample: {
					random: {
						percent: 100,
						responses: [],
					},
					result: {},
					expanded: false,
					remove_lines_with_null_or_NaN_cells: {
						columns: [],
						responses: [],
						
					},
					trim: {
						min: {
							percent: 0,
							columns: [],
							responses: [],
						},
						max: {
							percent: 0,
							columns: [],
							responses: [],
						},
						responses: [],
					},
					interquartile_range: {
						columns: [],
						responses: [],
					},
					standard_deviation: {
						columns: [],
						responses: [],
					}
				},
				generate_table_from_txt() {

					this.header = []
					this.src.table = []

					const s = this.src.txt
					let table = this.src.table
					const delimiter = this.src.delimiter
					const sample = this.sample
					const elm = this

					let i = 0
					let i_av = 0


					let nb_lines_read = 0

					function read_line() {
						line = []
						const len = s.length
						line_reading_loop:for(; i < len; ++i) {
							
							switch(s[i]) {
								
								case delimiter:
									line.push(s.slice(i_av,i).trim())
									i_av = i + 1
									break
								case '\n':
									if(i_av != i) {
										//console.log('new_line', s.slice(i_av,i).trim())
										line.push(s.slice(i_av,i).trim())
									}
									i_av = ++i
									break line_reading_loop;
								case '"': {
									++i
									for(; i < len && s[i] != '"'; ++i);
									break
								}
							}
						}
						if(i_av != i) line.push(s.slice(i_av,i).trim())
						++nb_lines_read
						return line
					}

					this.header = read_line()


					sample.remove_lines_with_null_or_NaN_cells.responses = []
					
					const filter_nulls =
						this.sample.remove_lines_with_null_or_NaN_cells.columns.length > 0 ?
						{
							indexes: this.sample.remove_lines_with_null_or_NaN_cells.columns.map(name => this.header.indexOf(name)),
							reject_count: 0,
							reject: function(line) {
								for(const i of this.indexes){
									if(line[i] == '' || line[i] == 'NaN' || line[i]=='NULL') {
										++this.reject_count
										return true
									}
									return false
								}
							},
							make_response: function(){
								sample.remove_lines_with_null_or_NaN_cells.responses.push({
									type: 'message',
									message: `removed ${this.reject_count} lines with null or NaN values`,
								})
							}
						}
						:
						null

					
					let original_nb_of_lines_excluding_header = {
						nb: null,
						get() {
							if(this.nb == null) {
								this.nb = 0;
								const len = s.length
								for(let j=0; j < len; ++j) {
									switch(s[j]) {
										case '"': for(; j < len && s[j] != '"'; ++j); break
										case '\n': ++this.nb; break
									}
								}
								++this.nb
							}
							return this.nb - 1// don't count header
						}
					}

					sample.random.responses = []
					const filter_extract_lines_at_random =
						this.sample.random.percent < 100 ?
						{
							boolean_array:function(){
								const boolean_array = new Int8Array(original_nb_of_lines_excluding_header.get())
								const len = boolean_array.length
								const chance = sample.random.percent/100
								let count = 0
								const len2 = parseInt(len * chance)

								if(chance < .25) {
									while(count < len2) {
										const c = Math.floor(Math.random() * len)
										if(boolean_array[c] == 0) {
											boolean_array[c] = 1
											++count
										}
									}
								}else if (chance > .75){
									boolean_array.fill(1)
									count = len
									while(count > len2) {
										const c = Math.floor(Math.random() * len)
										if(boolean_array[c] == 1) {
											boolean_array[c] = 0
											--count
										}
									}
								}else{

									for(let c = 0; c < len; ++c) {
										if(Math.random() <= chance) {
											boolean_array[c] = 1
											++count
										}
									}

									while(count < len2) {
										const c = Math.floor(Math.random() * len)
										if(boolean_array[c] == 0) {
											boolean_array[c] = 1
											++count
										}
									}

									while(count > len2) {
										const c = Math.floor(Math.random() * len)
										if(boolean_array[c] == 1) {
											boolean_array[c] = 0
											--count
										}
									}
								}
								if(count != len2) throw "sample random number of line error"
								//console.log('AAAAAAAAAAGGGGGGG',{boolean_array})
								return boolean_array
							}(),
							make_response(){
								sample.random.responses.push({
									type: 'message',
									//message: `sampled ${sample.random.percent}% of lines from ${this.boolean_array.length} initial lines down to ${parseInt(this.boolean_array.length * (sample.random.percent/100))} random lines`,
									message: `sampled ${sample.random.percent}% of lines from ${this.boolean_array.length} initial lines down to ${table.length} random lines`,
								})
							}
						}
						:
						null
					

					if(filter_extract_lines_at_random) {
						console.log({
							filter_extract_lines_at_random,
							nb: filter_extract_lines_at_random.boolean_array.reduce((s, e) => s + e, 0),
							nb2: parseInt(filter_extract_lines_at_random.boolean_array.length * (sample.random.percent/100))
						})
					}


					while(i < s.length) {
						
						const line = read_line()
						
						if(!(
							filter_nulls?.reject(line)
							|| (filter_extract_lines_at_random == null ? false : !filter_extract_lines_at_random.boolean_array[nb_lines_read-2])
						)) {
							table.push(line)
						}
					}

					console.log('table after filter nulls and extract lines at random', {table})


					filter_nulls?.make_response()
					filter_extract_lines_at_random?.make_response()


					//console.log('1',{table})


					
					
					const types = Array.from({length: this.header.length}, () => new cell_type(''))

					elm.types = types

					// determiner les types des colonnes
					for(const line of table) {
						const len = Math.min(line.length, types.length)
						for(let k = 0; k < len; ++k) {
							//console.log('types av', types[k].type.name)
							//console.log('cell', line[k], '->', new cell_type(line[k]).type.name)
							types[k].accumulate(line[k])
							//console.log('types ap', types[k].type.name)
							//console.log('')
						}
					}

					// convertir les cellules
					for(const line of table) {
						for(let k = 0; k < line.length; ++k) {
							line[k] = types[k].convert(line[k])
						}
					}

					console.log('types ', types.map(t => t.type.name))


					const get_filter_with_predicate_on_index_in_sorted_array = (make_predicate, column_names, get_responses)=>{
						return {
							column_rejecters:((()=>{
								const column_rejecters = []
								for(const column_name of column_names) {
									const column_index = this.header.indexOf(column_name)
									//const column_values = this.src.table.map((line, index) => [line[column_index]).sort((a, b)=> a. - b.)
									const column_values = this.src.table.map((line, line_index) => [line[column_index], line_index]).sort((a, b) => isNaN(a[0]) ? -1 : isNaN(b[0]) ? 1 : a[0] - b[0])
									//const min_index_in_sorted_array = Math.floor((sample.trim.min.percent/100) * column_values.length)
									const line_index_to_index_in_sorted_array = new Int32Array(column_values.length)
									let index_in_sorted_array = 0
									for(const [value, line_index] of column_values) {
										line_index_to_index_in_sorted_array[line_index] = index_in_sorted_array++
									}
									const predicate = make_predicate({column_index})
									column_rejecters.push({
										column_index,
										//min_index_in_sorted_array,
										line_index_to_index_in_sorted_array,
										//reject: function(line_index) { return !predicate(this.line_index_to_index_in_sorted_array[line_index]) }
										keep: function(line_index) { return predicate(this.line_index_to_index_in_sorted_array[line_index]) }
									})
								}
								return column_rejecters
							})()),
							number_of_line_rejected: function(){
								const r = {}
								for(const column_name of column_names) r[elm.header.indexOf(column_name)] = 0
								return r
							}(),
							min_value_rejected: {},
							max_value_rejected: {},
							reject(line, line_index) {
								for(const column_rejecter of this.column_rejecters) if(!column_rejecter.keep(line_index)) {
									const column_ix = column_rejecter.column_index
									if(line[column_ix] !== undefined) {
										const value = line[column_ix]
										const min_val = this.min_value_rejected[column_ix]
										const max_val = this.max_value_rejected[column_ix]
										if(min_val === undefined ? true : value < min_val) this.min_value_rejected[column_ix] = value
										if(max_val === undefined ? true : value > max_val) this.max_value_rejected[column_ix] = value
										++this.number_of_line_rejected[column_ix]
										return true
									}
								}
								return false
							},
							make_response(){

								let total_number_of_lines_rejected = 0
								for(const [column_index, count] of Object.entries(this.number_of_line_rejected)) {
									total_number_of_lines_rejected += count
								}

								get_responses().push({
									type: 'message',
									message:
										`removed ${total_number_of_lines_rejected} lines:`
										+ column_names
											.map(column_name => elm.header.indexOf(column_name))
											.map(column_ix => `<br>${this.number_of_line_rejected[column_ix]} lines from <i>${elm.header[column_ix]}</i> with values ranging from <span style='color:rgb(181, 69, 4);'>${this.min_value_rejected[column_ix]}</span> to <span style='color:rgb(181, 69, 4);'>${this.max_value_rejected[column_ix]}</span>`).join('')
										//+ (this.number_of_line_rejected > 0 ? ` with ranging values from <span style='color:rgb(181, 69, 4);'>${this.min_value_rejected}</span> to <span style='color:rgb(181, 69, 4);'>${this.max_value_rejected}</span>`:''),
								})
							}
						}
					}

					sample.trim.min.responses = []
					const filter_min_values =
						sample.trim.min.percent > 0 ?
						function(){
							const min_index_in_sorted_array = Math.floor((sample.trim.min.percent/100) * table.length) 
							return get_filter_with_predicate_on_index_in_sorted_array(
								({column_index}) => (index => index > min_index_in_sorted_array),
								sample.trim.min.columns,
								()=>sample.trim.min.responses
							)
						}()
						:
						null

					console.log({filter_min_values:filter_min_values})
					//throw "dgdmlgk"

					sample.trim.max.responses = []
					const filter_max_values =
						sample.trim.max.percent > 0 ?
						function(){
							const max_index_in_sorted_array = Math.floor((1-sample.trim.max.percent/100) * table.length) 
							return get_filter_with_predicate_on_index_in_sorted_array(
								({column_index}) => (index => index < max_index_in_sorted_array),
								sample.trim.max.columns,
								()=>sample.trim.max.responses
							)
						}()
						:
						null

					
					


					

					console.log({filter_min_values,filter_max_values})
					if(filter_min_values || filter_max_values) {
						
						table = table.filter((line, index) => !(
												filter_min_values?.reject(line, index)
												|| filter_max_values?.reject(line, index)
											))
						filter_min_values?.make_response()
						filter_max_values?.make_response()
						
					}



					{// interquartile_range
						sample.interquartile_range.responses = []
						
						for(const column_name of sample.interquartile_range.columns) {
							try{
								const column_index = elm.header.indexOf(column_name)

								if(!types[column_index].is(cell_type.types.float) && !types[column_index].is(cell_type.types.int)) {
									throw `type of column must be float or int not ${types[column_index].name}`
								}
			
								// https://blog.zhaytam.com/2019/07/15/outliers-detection-in-pyspark-2-interquartile-range/
			
								const frac1 = .25
								const frac3 = .75
			
								const sorted_values = table.filter(line => line[column_index] !== undefined).map(line => line[column_index]).sort((a, b) => a - b)
			
								const q1 = sorted_values[parseInt(frac1 * sorted_values.length)]
								const q3 = sorted_values[parseInt(frac3 * sorted_values.length)]
			
								const iqr = q3 - q1
			
								// 1.5 doit rester 1.5: https://math.stackexchange.com/questions/966331/why-john-tukey-set-1-5-iqr-to-detect-outliers-instead-of-1-or-2
			
								const mini = q1 - iqr*1.5
								const maxi = q3 + iqr*1.5
			
								//let removed_count = 0
								const table_length_before = table.length
								table = table.filter(line => {
									const val = line[column_index]
									return val !== undefined && mini <= val && val <= maxi
								})
			
								sample.interquartile_range.responses.push({
									type: 'message',
									message:
									`remove outliers with the <i>interquartile range</i> method on column <i>${column_name}</i>:<br>parameters: frac1 = ${frac1}, frac3 = ${frac3}, q1 = ${q1}, q3 = ${q3}<br>values are filtered to be between ${mini} and ${maxi}<br>from a total of ${table_length_before} lines down to ${table.length} lines (${table_length_before-table.length} lines removed)`,
									
								})
							}
							catch(ex){
								sample.interquartile_range.responses.push({
									type:'error',
									title: `calcul of <b>interquartile_range</b> on column <b>${column_name}</b> failed`,
									expanded: false,
									exception: ''+ex,
									traceback: ex.stack,
								})
							}
						}
						
					}
					


					{// standard_deviation
						sample.standard_deviation.responses = []
						
						for(const column_name of sample.standard_deviation.columns) {
							try{
								const column_index = elm.header.indexOf(column_name)
								
								if(!types[column_index].is(cell_type.types.float) && !types[column_index].is(cell_type.types.int)) {
									throw `type of column must be float or int not ${types[column_index].name}`
								}
			
								// https://towardsdatascience.com/outlier-detection-part1-821d714524c
			
								let mean = function() {
										let s = 0, count = 0
										for(const line of table) if(line[column_index] !== undefined) {
											s += line[column_index]
											++count
										}
										return s/count
									}()
			
								let stddev = function(){
										let s = 0, count = 0
										for(const line of table) if(line[column_index] !== undefined) {
											s += (line[column_index]-mean)**2
											++count
										}
										return Math.sqrt(s/count)
									}()
			
								const lower_limit = mean - 3 * stddev
								const upper_limit = mean + 3 * stddev
			
			
								let removed_count = 0
								const table_length_before = table.length
								table = this.src.table = table.filter(line => {
									const val = line[column_index]
									return val !== undefined && lower_limit <= val && val <= upper_limit
								})
			
								sample.standard_deviation.responses.push({
									type: 'message',
									message: `remove outliers with the <i>standard deviation</i> method on column <i>${column_name}</i>:`
									+	`<br>infos: average = ${mean}, standard_deviation = ${stddev}`
									+	`<br>values are filtered to be between ${lower_limit} and ${upper_limit}`
									+	`<br>from a total of ${table_length_before} lines down to ${table.length} lines (${table_length_before-table.length} lines removed)`,
								})
							}
							catch(ex){
								sample.standard_deviation.responses.push({
									type:'error',
									title: `calcul of <b>standard_deviation</b> on column <b>${column_name}</b> failed`,
									expanded: false,
									exception: ''+ex,
									traceback: ex.stack,
								})
							}
						}
					}
				

					


					table.query = (make_accumulator, get_group_id = (line)=>1) => {

						const groups = new Map()

						for(const line of table) {

							const group_id = get_group_id(line)

							if (!groups.has(group_id)) {
								groups.set(
									group_id,
									{
										id: group_id,
										accumulator: make_accumulator(),
										get result() { return this.accumulator.val },
										get sensibility() { return this.accumulator.sensibility },
									},
								)
							}

							groups.get(group_id).accumulator.accumulate?.(line)
						}

						groups.prt = ()=>{
							for(const [group_id, group] of groups) {
								console.log(`result of group ${group_id}:`, group.result)
							}
						}

						return groups
					}

					this.src.table = table

				},

				requests: [],
				aj_request(function_name) {
					
					let request = null

					this.requests.push(request = {
						group_by: {
							column: this.header.at(0),
							
						},

						_function: function_name,
						get function() {return this._function},
						set function(val) {
							if(val == 'quantile') {
								this.quantile = .5
							} else {
								this.quantile = null
							}
							if(functions_infos[val].positive_result_default_value) {
								this.make_result_positive = true
							}
							this._function = val
							this.function_infos = functions_infos[val]
							this.maj_columns()
						},

						function_infos: functions_infos[function_name],
						columns: [],
						maj_group_by() {
							if(this._parent.header.includes(this.group_by.column)) return
							this.group_by.column = this._parent.header.at(0)
						},
						maj_columns() {

							const min_len = functions_infos[this.function].nb_columns_min
							const max_len = functions_infos[this.function].nb_columns_max

							if(max_len == 0) {
								this.columns = []
								return
							}

							while(this.columns.length < min_len && min_len <= this.elm.header.length) {
								const min_len_av = min_len
								for(let i = 0; i < this.elm.header.length; ++i) {
									const column_name = this.elm.header[i]
									const type = this.elm.types[i]
									if(type !== undefined && type.is_number()) {
										this.columns.push(column_name)
									}
								}
								if(min_len == min_len_av) {
									//throw `can't find enough columns containing values (column types are [${type}])`
									break
								}
							}

							while(this.columns.length < min_len && min_len <= this.elm.header.length) {
								const min_len_av = min_len
								for(const column_name of this.elm.header) {
									if(!this.columns.includes(column_name)) {
										this.columns.push(column_name)
									}
								}
								if(min_len == min_len_av) {
									//throw `can't find enough columns containing values (column types are [${type}])`
									break
								}
							}

							while(this.columns.length > Math.max(max_len,0)) {
								this.columns.shift()
							}

							this.set_clamp_range_to_min_max()
						},
						aj_column(column_name) {
							this.columns.push(column_name)
							this.maj_columns()
						},
						ej_column(column_name) {
							const index = this.columns.indexOf(column_name);
							if (index >= 0) { 
								this.columns.splice(index, 1)
								this.maj_columns()
							}
						},
						clamp_range: [
							Number.MIN_VALUE,
							Number.MAX_VALUE,
						],
						set_clamp_range_to_min_max() {
							if(this.columns.length == 1) {
								const column_name = this.columns[0]
								const column_index = this.elm.header.indexOf(column_name)
								if(column_index >= 0) {
									let min = Number.MAX_VALUE
									let max = Number.MIN_VALUE
									for(const line of this.elm.src.table) {
										min = Math.min(min, line[column_index])
										max = Math.max(max, line[column_index])
									}
									this.clamp_range = [min,max]
								}
							}
						},
						clamp_range_prev: null,
						quantile: null,
						quantile_prev: null,
						make_result_positive: false,
						make_result_positive_set_by_user: false,
						budget_privacy_ponderation: 1,
						filter: null,
						more_options_expanded: false,
						responses: [],

						get name() {
							return this._parent.name
								+ '_'
								+ this.function
								+ '_' + this.columns
								+ (this.group_by.column != null ? '_by_' + this.group_by.column : '')
						},
					})

					request._parent = this
					request.elm = this
					request.maj_columns()
					request.maj_group_by()

					//request.set_clamp_range_to_min_max()

					return request
				}
			})

			src._parent = e

			e.generate_table_from_txt()

			e.aj_request('average')

			return e
		}
		catch(ex) {
			//this.elms.req.responses.push({
			(e == null ? this.elms : e).responses.push({
				type:'error',
				title: `error while reading csv text`,
				expanded: false,
				exception: ''+ex,
				traceback: ex.stack,
			})
		}
	},
}






function* islice(arr, i, fin_exclue) {
	i ??= 0
	fin_exclue ??= arr.length
	for(let c = i; c < fin_exclue; ++c) yield arr[c]
}

function isFloat(n){
    return Number(n) === n && n % 1 !== 0;
}

function to_s(e) {
	if(isFloat(e) && Math.abs(e) > 1) {
		return +e.toFixed(2)
	}
	else return e
}


function run_session() {

	console.log('run_session')

	localStorage.clear()// sinon les ancien résultats sont toujours dans localStorage

	let request_counter = 0


	

	const sum_of_all_budget_privacy_ponderations = function(){
		let s = 0
		for(const e of persist.elms) {
			for(const req of e.requests) {
				s += req.budget_privacy_ponderation
			}
		}
		return s
	}()

	for(const e of persist.elms) {

		e.responses = []

		e.generate_table_from_txt()

		const table_without_header = e.requests.length > 0 ? e.src.table.slice(1) : null

		const accumulators_cache = {}

		for(const req of e.requests) {

			req.responses = []

			++request_counter

			try{

				const column_index = e.header.indexOf(req.columns[0])

				
				const list_of_groupby_column_indexes =
					typeof req.group_by.column == 'string' ?
						[e.header.indexOf(req.group_by.column)]
					: req.group_by.column == null ?
						[]
					:
						req.group_by.column.map(column_name => e.header.indexOf(column_name))


				let get_group_id = null
				{
					if(list_of_groupby_column_indexes.length == 0) {
						get_group_id = () => 0
					}
					else if(list_of_groupby_column_indexes.length == 1){
						const index = list_of_groupby_column_indexes[0]
						get_group_id = (line) => line[index]
					}
					else {
						// marche dans tous les cas mais  par souci de vitesse
						get_group_id = (line)=> list_of_groupby_column_indexes.map(i => i < line.length ? line[i] : null).join(e.src.delimiter)
					}
				}
				
				let clamped_table_without_header = table_without_header

				if(!functions_infos[req.function].sensibility_equals_to_1){// clamp values

					clamped_table_without_header = table_without_header.slice()

					const [mini, maxi] = req.clamp_range
					if(mini != Number.MIN_VALUE || maxi != Number.MAX_VALUE) {
						for(const line of islice(clamped_table_without_header, 1)) { if(line[1] < mini) line[1] = mini; if(line[1] > maxi) line[1] = maxi; }
					}
				}

				//const accumulator_makers = accumulators_cache[`${column_index}#${req.quantile}`] ??= get_accumulators({
				const accumulator_makers = get_accumulators({
					column_index,
					clamped_table_without_header,
					quantile_ratio: req.quantile,
					max_possible: req.clamp_range[0],
					min_possible: req.clamp_range[1],
				})

				//if(req.function == 'quantile') {
				//	accumulator_class = accumulator_class({quantile_ratio: req.quantile})
				//}

				const groups = e.src.table.query(
					accumulator_makers[req.function].maker({}),
					get_group_id
				)


				let csv_out = [[]]

				{
					for(const column_index of list_of_groupby_column_indexes) {
						csv_out[0].push(e.header[column_index])
					}

					csv_out[0].push(column_index >= 1 ? e.header[column_index] + '_' + req.function : 'count')
		
					for(const[group_id, group] of groups.entries()) {
						const line = []

						if(list_of_groupby_column_indexes.length > 0) {
							for(const column_index of list_of_groupby_column_indexes) {
								line.push(group_id)
							}
						}else{
							line.push('on_all')
						}
						
						const val = group.result

						if(req.make_result_positive && val < 0) val = 0

						line.push(val)
						csv_out.push(line)
					}
				}


				console.log(csv_out)

				//req.non_anonymised_result = e.src.path

				const csv_name_anonymised = `${req.name}_anonymised_${request_counter}.csv`
				const csv_name_non_anonymised =  `${req.name}_non_anonymised_${request_counter}.csv`



				

				const csv_out_anonymised = structuredClone(csv_out)

				const sensibilité =
					req.function == 'count' || req.function == 'count_distinct' ?
						1
						:
						e.src.table.reduce((sensibilité, line) => Math.max(sensibilité, Math.abs(line[column_index])), 0)


				const privacy_budget = persist.privacy_budget*req.budget_privacy_ponderation/sum_of_all_budget_privacy_ponderations

				/*const etroitesse = privacy_budget/sensibilité

				//const aile_droite_de_la_dp_repartition = x => Math.exp(-x/sensibilité)/(2*sensibilité)
				const aile_droite_de_la_dp_repartition = x => Math.exp(-x*etroitesse)/(2*etroitesse)

				let A = 0
				const dx = .01/etroitesse
				const x0 = dx/2

				{
					let x = x0
					const x_max = 2./etroitesse
					while(x <= x_max) {
						A += aile_droite_de_la_dp_repartition(x)*dx
						x += dx
					}
				}
				
				function rand_noise() {
					
					const A2 = Math.random() * A
					let a = 0, x = x0

					do{
						a += aile_droite_de_la_dp_repartition(x)*dx
						x += dx
					} while (a < A2)

					return (Math.random() > .5 ? 1 : -1) * x
				}*/

				/*let A = 0
				const dx = .01
				const x0 = dx/2

				{
					let x = x0
					while(x <= 5) {
						A += Math.exp(x)*dx
						x += dx
					}
				}*/
				
				function rand_noise() {

					const dx = .01
					const x0 = dx/2
					
					let A2 = Math.random()// * Math.exp(0)
					let a = 0, x = x0

					do{
						a += Math.exp(x)*dx
						x += dx
					} while (a < A2)

					return (Math.random() > .5 ? 1 : -1) * x
				}

				const sensibilities = Array.from(groups).map(([key, group]) => group.sensibility)

				console.log({sensibilities})

				{
					let k = 0
					for(const line of islice(csv_out_anonymised, 1)) {
						const d = sensibilities[k++]/privacy_budget
						line[1] += d * rand_noise()
						const remove_precision = d*100
						line[1] = Math.floor(remove_precision*line[1]+.5)/remove_precision
					}
				}

				


				if(req.make_result_positive) {
					for(const line of islice(csv_out_anonymised, 1)) if(line[1] < 0) line[1] = 0
					for(const line of islice(csv_out_anonymised, 1)) if(line[1] < 0) line[1] = 0
				}

				if(functions_infos[req.function].clamp_result){// clamp values
					const [mini, maxi] = req.clamp_range
					if(mini != Number.MIN_VALUE || maxi != Number.MAX_VALUE) {
						for(const line of islice(csv_out_anonymised, 1)) { if(line[1] < mini) line[1] = mini; if(line[1] > maxi) line[1] = maxi; }
					}
				}

				const result_type =
					req.function == 'count' || req.function == 'count_distinct' ?
						cell_type.types.int
						:
						e.types[column_index].type


				// round if itegers
				if(result_type === cell_type.types.int) for(const line of islice(csv_out_anonymised,1)) line[1] = Math.floor(line[1] + .5)

				localStorage.setItem(csv_name_anonymised, csv_out_anonymised.map(line => line.join(';')).join('\n'))
				localStorage.setItem(csv_name_non_anonymised, csv_out.map(line => line.join(';')).join('\n'))

				function make_text_of_html_table(table, max_lines = 10) {
					return `<table><thead>${table[0].map(name => `<td>${name}</td>`).join('')}</thead><tbody>${table.slice(1,max_lines).map(line => '<tr>'+line.map(val => `<td>${to_s(val)}</td>`).join('')+'</tr>').join('')}</tbody></table>`
				}
				/*<tag-name style="white-space:pre">
						<br>${csv_out.slice(0,10).map(line => line.join(';&#9;&#9;')).join('<br>')}
					</tag-name> */
				req.responses.push({
					type: 'message',
					message: `<u>non anonymised result:</u>
					<br>
					<br>${csv_out.length-1} lines
					<br>
					<br>
					${make_text_of_html_table(csv_out)}
					${csv_out.length > 10 ? '...' : ''}`,
					subs: [
						{
							type:'path',
							expanded: true,
							path: 'localStorage:'+csv_name_non_anonymised,
							something: "somethingsomethingsomething",
						}
					],
				})

				/*<tag-name style="white-space:pre">
						<br>${csv_out_anonymised.slice(0,10).map((line, index) => [...line, (index == 0 ? 'noise added' : line[1] - csv_out[index][1])].join(';&#9;&#9;')).join('<br>')}
					</tag-name>*/

				req.responses.push({
					type: 'message',
					message: `<u>anonymised result:</u>
					<br>
					<br>${csv_out_anonymised.length-1} lines
					<br>
					<br>average sensibility: ${to_s(sensibilities.reduce((acc,val)=>acc+val,0)/sensibilities.length)}
					<br>budget privacy used for this request: ${privacy_budget}
					<br>
					<br>
					${make_text_of_html_table(csv_out_anonymised.slice(0,10).map((line, index) => [...line,(index == 0 ? 'added noise 🔊' : to_s(line[1] - csv_out[index][1])), (index == 0 ? 'sensibility': to_s(sensibilities[index-1]))]))}
					${csv_out_anonymised.length > 10 ? '...' : ''}`,
					subs: [
						{
							type:'path',
							expanded: true,
							path: 'localStorage:'+csv_name_anonymised,
							something: "somethingsomethingsomethingsomethingsomethingsomething",
						}
					],
				})

				//groups.prt()
			}
			catch(ex) {
				req.responses.push({
					type:'error',
					title: `calcul of <b>${req.function}</b> failed`,
					expanded: false,
					exception: ''+ex,
					traceback: ex.stack,
				})
			}
		}
	}

	console.log('end_session')
}



function open_csv(name, txt) {
	const blob = new Blob([decodeURIComponent('%ef%bb%bf') /*prepend bom*/, txt], {type: 'text/csv;charset=utf-8'});
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	document.body.appendChild(a);
	a.click();
	a.remove()
}

function open_file(path) {

	if(path.startsWith('localStorage:')){
		const name = path.substring('localStorage:'.length)
		const csv = localStorage.getItem(name)
		open_csv(name, csv)
		/*const blob = new Blob([decodeURIComponent('%ef%bb%bf'), csv], {type: 'text/csv;charset=utf-8'});
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = name;
		document.body.appendChild(a);
		a.click();
		a.remove()*/
	}
	else if(path.startsWith('uploaded_csv:')) {
		const name = path.substring('uploaded_csv:'.length)
		for(const e of persist.elms) {
			if(e.name == name) {
				//const csv = localStorage.getItem(name)
				open_csv(name, e.src.txt)
				/*const blob = new Blob([decodeURIComponent('%ef%bb%bf'), e.src.txt], {type: 'text/csv;charset=utf-8'});
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = name;
				document.body.appendChild(a);
				a.click();
				a.remove()*/
				return
			}
		}
		throw "can't find uploaded csv " + path
	}
	else {
		throw "can't open path " + path
	}
}



function test_function(make_accumulator, get_group_id = (line)=>1) {

	result = e.src.table.query(make_accumulator, get_group_id)

	for(const [group_id, group] of result) {
		console.log(`result of group ${group_id}:`, group.result)
	}
}

localStorage.clear()// sinon les ancien résultats sont toujours dans localStorage

// "dowload" from local storage
function download_all_result_folder() {
	for (var i = 0; i < localStorage.length; i++){
		let name = localStorage.key(i)
		if(name.endsWith('.csv')) {
			const txt = localStorage.getItem(name)
			if(name.startsWith('localStorage:')) {
				name = name.substring('localStorage:'.length)
			}
			open_csv(name, txt)
		}
	}
}

//e = persist.aj_csv({name:"mon_nom_de_fichier_csv", txt: "denomination;quatite;valeur\nblaster;56;5.30\nescen;8;23.30\n"})
const test_csv = persist.aj_csv({name:"example_of_csv", txt: `Name;Quantity;Category
A;44.021943151371744;Category_A
B;347.5643316815196;Category_B
C;262.0631562148337;Category_C
water;248.16572402691918;Category_C
earth;39.50995248584047;Category_A
fire;59.28681362971372;Category_C
air;58.25158460864495;Category_A
blood;45.1657727175713;Category_A
graines;869.1502727175713;Category_C
gravier;25.15180519928964;Category_A
verre;934.8109605336693;Category_B
void;240.1570496210759;Category_B`})

/*const test_csv2 = persist.aj_csv({name:"example_of_csv_2", txt: `Name,Quantity,Category
A,44.021943151371744,Category_A
B,347.5643316815196,Category_B
C,262.0631562148337,Category_C
water,248.16572402691918,Category_C
earth,39.50995248584047,Category_A
fire,59.28681362971372,Category_C
air,58.25158460864495,Category_A
blood,45.1657727175713,Category_A
graines,869.1502727175713,Category_C
gravier,25.15180519928964,Category_A
verre,934.8109605336693,Category_B
void,240.1570496210759,Category_B`})*/

test_csv.requests[0].group_by.column = 'Category'

//persist.create_csv_table_from_its_txt(e)
//persist.elms[0].create_table_from_txt()

//console.log(e)
//console.log(e.header)
//console.log(e.src.table)


//request = e.aj_request('count')

//console.log('request:', request)

